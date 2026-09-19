-- ===========================================================================
-- ADMIN · LIQUIDACIÓN SEMANAL — agrupa comisiones ya ELIGIBLE en un pago
-- semanal por vendedor. `sale_commissions` sigue siendo la ÚNICA fuente
-- autoritativa del monto de cada comisión: este módulo SOLO lee, agrupa y
-- marca (`liquidation_id`) — nunca recalcula ni reescribe un monto de
-- comisión ya calculado.
--
-- Dos ejes de tiempo, deliberadamente independientes (ver
-- `_liquidation_week_start` y los comentarios en `admin_liquidation_detail`):
--   - "Actividad de la semana" (informativa): ventas agrupadas por su propia
--     fecha de negocio (sale_date), sin importar cuándo se cobran.
--   - "Comisiones a liquidar" (dinero real): comisiones ELIGIBLE agrupadas
--     por `eligible_at` (cuándo la venta se pagó), NUNCA por la semana en
--     que la venta apareció como PENDING/SOLD. Esto es lo que garantiza que
--     una liquidación ya PAID nunca reciba items retroactivos.
--
-- Ciclo de vida: DRAFT (se pueden reclamar más comisiones ELIGIBLE nuevas y
-- agregar ajustes) → APPROVED (composición de comisiones congelada; ajustes
-- aún editables) → PAID (todo congelado, incl. ajustes).
--
-- Anti-doble-liquidación: `sale_commissions.liquidation_id` es una columna
-- ÚNICA (no una tabla puente many-to-many) — una fila de comisión solo puede
-- apuntar a UNA liquidación a la vez, por construcción. El "claim" (reclamo)
-- es un único `UPDATE ... WHERE liquidation_id IS NULL` atómico: bajo
-- concurrencia, Postgres serializa las escrituras en conflicto sobre la
-- misma fila (re-evalúa el WHERE tras liberar el lock de la primera
-- transacción), así que una segunda liquidación que intente reclamar la
-- misma comisión simplemente no la encuentra ya disponible. Mismo patrón
-- probado con una carrera real de dos sesiones en el módulo de Inventario.
--
-- Verificado antes de escribir esta migración (no asumido): una vez que una
-- venta está PAID, `update_confirmed_cuba_sale` la rechaza incondicionalmente
-- (status check `in ('PENDING','SOLD')`, ver 20260910280000), y el recálculo
-- de comisión de `approve_sale_edit_request` solo corre `if status = 'SOLD'`.
-- Es decir: una comisión ELIGIBLE (que exige la venta PAID) es estructuralmente
-- inmutable por cualquier camino ya existente — reclamarla en una liquidación
-- es seguro, nada puede cambiarla después.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. weekly_liquidations — una fila por (vendedor, semana lunes-domingo).
-- ---------------------------------------------------------------------------
create table public.weekly_liquidations (
  id                         uuid primary key default gen_random_uuid(),
  seller_id                  uuid not null references public.profiles (id) on delete restrict,
  week_start_date            date not null,
  week_end_date              date not null,
  status                     text not null default 'DRAFT'
                               check (status in ('DRAFT', 'APPROVED', 'PAID')),
  commissions_subtotal_cents bigint not null default 0,
  adjustments_total_cents    bigint not null default 0,
  total_to_pay_cents         bigint not null default 0,
  approved_at                timestamptz,
  approved_by                uuid references public.profiles (id),
  paid_at                    timestamptz,
  paid_by                    uuid references public.profiles (id),
  payment_reference          text,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  unique (seller_id, week_start_date)
);
comment on table public.weekly_liquidations is
  'Una liquidación semanal por vendedor. commissions_subtotal_cents/adjustments_total_cents/total_to_pay_cents son cachés derivados (recalculados al reclamar comisiones o agregar ajustes) — nunca la fuente de verdad de un monto individual.';
create index weekly_liquidations_week_idx on public.weekly_liquidations (week_start_date);
create index weekly_liquidations_seller_idx on public.weekly_liquidations (seller_id, status);

alter table public.weekly_liquidations enable row level security;
create policy weekly_liquidations_select on public.weekly_liquidations
  for select using (public.is_admin() or (seller_id = auth.uid() and status in ('APPROVED', 'PAID')));
-- Sin insert/update/delete a authenticated: toda mutación pasa por RPC
-- SECURITY DEFINER (mismo patrón que sale_commissions/commission_events).

-- ---------------------------------------------------------------------------
-- 2. weekly_liquidation_adjustments — bonos/ajustes manuales, SIEMPRE
--    entidades separadas; nunca se reescribe una comisión para reflejarlos.
-- ---------------------------------------------------------------------------
create table public.weekly_liquidation_adjustments (
  id              uuid primary key default gen_random_uuid(),
  liquidation_id  uuid not null references public.weekly_liquidations (id) on delete cascade,
  adjustment_type text not null check (adjustment_type in ('BONO', 'AJUSTE_POSITIVO', 'AJUSTE_NEGATIVO')),
  amount_cents    bigint not null check (amount_cents > 0),
  reason          text not null,
  created_by      uuid not null references public.profiles (id),
  created_at      timestamptz not null default now()
);
comment on column public.weekly_liquidation_adjustments.amount_cents is
  'Siempre positivo (magnitud). El signo lo aplica adjustment_type al sumar al total (AJUSTE_NEGATIVO resta).';
create index weekly_liquidation_adjustments_liq_idx on public.weekly_liquidation_adjustments (liquidation_id);

alter table public.weekly_liquidation_adjustments enable row level security;
create policy weekly_liquidation_adjustments_select on public.weekly_liquidation_adjustments
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.weekly_liquidations wl
      where wl.id = liquidation_id and wl.seller_id = auth.uid() and wl.status in ('APPROVED', 'PAID')
    )
  );

-- ---------------------------------------------------------------------------
-- 3. weekly_liquidation_events — auditoría del ciclo de vida (admin-only,
--    mismo patrón que commission_events/inventory_unit_events).
-- ---------------------------------------------------------------------------
create table public.weekly_liquidation_events (
  id             uuid primary key default gen_random_uuid(),
  liquidation_id uuid not null references public.weekly_liquidations (id) on delete cascade,
  event_type     text not null check (event_type in (
                   'CREATED', 'ITEMS_CLAIMED', 'ADJUSTMENT_ADDED', 'APPROVED', 'PAID'
                 )),
  actor_id       uuid references public.profiles (id),
  detail         jsonb,
  created_at     timestamptz not null default now()
);
create index weekly_liquidation_events_liq_idx on public.weekly_liquidation_events (liquidation_id);

alter table public.weekly_liquidation_events enable row level security;
create policy weekly_liquidation_events_select on public.weekly_liquidation_events
  for select using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 4. sale_commissions.liquidation_id — el "reclamo". Nullable; una comisión
--    sin liquidación es dinero ELIGIBLE todavía no agrupado en ningún pago.
-- ---------------------------------------------------------------------------
alter table public.sale_commissions
  add column if not exists liquidation_id uuid references public.weekly_liquidations (id);
comment on column public.sale_commissions.liquidation_id is
  'NULL = todavía no reclamada por ninguna liquidación semanal. Una vez asignada, es la ÚNICA liquidación a la que pertenece esta comisión (columna simple, no tabla puente) — así se garantiza que nunca se liquide dos veces.';
create index sale_commissions_liquidation_idx on public.sale_commissions (liquidation_id);

-- ---------------------------------------------------------------------------
-- 5. Helper privado: normaliza cualquier fecha al lunes de su semana ISO
--    (date_trunc('week', ...) de Postgres ya empieza en lunes).
-- ---------------------------------------------------------------------------
create or replace function public._liquidation_week_start(p_date date)
returns date
language sql
immutable
as $$
  select (date_trunc('week', p_date::timestamp))::date;
$$;
revoke all on function public._liquidation_week_start(date) from public, anon;

-- ---------------------------------------------------------------------------
-- 6. admin_liquidation_week_list — listado por semana (una fila por
--    vendedor con actividad o dinero elegible en esa semana).
-- ---------------------------------------------------------------------------
create or replace function public.admin_liquidation_week_list(p_week_start date default null)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_week_start date := public._liquidation_week_start(coalesce(p_week_start, current_date));
  v_week_end   date := v_week_start + 6;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  return jsonb_build_object(
    'ok', true,
    'weekStart', v_week_start,
    'weekEnd', v_week_end,
    'rows', coalesce((
      select jsonb_agg(row_data order by row_data->>'sellerName')
      from (
        select jsonb_build_object(
          'sellerId', p.id,
          'sellerName', p.full_name,
          'liquidationId', wl.id,
          'status', coalesce(wl.status, 'NONE'),
          'pendingSalesCount', coalesce(act.pending_count, 0),
          'soldSalesCount', coalesce(act.sold_count, 0),
          'paidSalesCount', coalesce(act.paid_count, 0),
          'eligibleCommissionsCount', coalesce(claimed.cnt, unclaimed.cnt, 0),
          'subtotalCents', coalesce(wl.commissions_subtotal_cents, unclaimed.sum_cents, 0),
          'adjustmentsCents', coalesce(wl.adjustments_total_cents, 0),
          'totalCents', coalesce(wl.total_to_pay_cents, unclaimed.sum_cents, 0)
        ) as row_data,
        wl.id as wl_id, act.pending_count, act.sold_count, act.paid_count, unclaimed.cnt as unclaimed_cnt
        from public.profiles p
        left join public.weekly_liquidations wl
          on wl.seller_id = p.id and wl.week_start_date = v_week_start
        left join lateral (
          select
            count(*) filter (where s.status = 'PENDING') as pending_count,
            count(*) filter (where s.status = 'SOLD') as sold_count,
            count(*) filter (where s.status = 'PAID') as paid_count
          from public.sales s
          where s.seller_id = p.id
            and s.operation_type = 'CUBA'
            and coalesce(s.sale_date, s.created_at::date) between v_week_start and v_week_end
        ) act on true
        left join lateral (
          select count(*) as cnt, coalesce(sum(sc.final_commission_cents), 0) as sum_cents
          from public.sale_commissions sc
          where sc.liquidation_id = wl.id
        ) claimed on wl.id is not null
        left join lateral (
          select count(*) as cnt, coalesce(sum(sc.final_commission_cents), 0) as sum_cents
          from public.sale_commissions sc
          where sc.seller_id = p.id
            and sc.status = 'ELIGIBLE'
            and sc.liquidation_id is null
            and sc.eligible_at >= v_week_start::timestamptz
            and sc.eligible_at < (v_week_end + 1)::timestamptz
        ) unclaimed on wl.id is null
        where p.role = 'seller'
      ) x
      where x.wl_id is not null
        or coalesce(x.pending_count, 0) > 0
        or coalesce(x.sold_count, 0) > 0
        or coalesce(x.paid_count, 0) > 0
        or coalesce(x.unclaimed_cnt, 0) > 0
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.admin_liquidation_week_list(date) from public, anon;
grant execute on function public.admin_liquidation_week_list(date) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. admin_liquidation_create_draft — idempotente: crea (o devuelve) la
--    liquidación DRAFT de (vendedor, semana) y reclama comisiones ELIGIBLE
--    disponibles. Si ya avanzó de DRAFT, solo la devuelve (no reclama más).
-- ---------------------------------------------------------------------------
create or replace function public.admin_liquidation_create_draft(p_seller_id uuid, p_week_start date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid           uuid := auth.uid();
  v_week_start    date := public._liquidation_week_start(p_week_start);
  v_week_end      date := v_week_start + 6;
  v_liq           public.weekly_liquidations;
  v_created       boolean := false;
  v_claimed_count int := 0;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;
  if not exists (select 1 from public.profiles where id = p_seller_id and role = 'seller') then
    return jsonb_build_object('ok', false, 'code', 'SELLER_NOT_FOUND');
  end if;

  -- Upsert a prueba de carrera: si dos admins crean la misma (vendedor,
  -- semana) a la vez, exactamente uno inserta; el otro cae al select-for-update.
  insert into public.weekly_liquidations (seller_id, week_start_date, week_end_date, status)
  values (p_seller_id, v_week_start, v_week_end, 'DRAFT')
  on conflict (seller_id, week_start_date) do nothing
  returning * into v_liq;

  if found then
    v_created := true;
    insert into public.weekly_liquidation_events (liquidation_id, event_type, actor_id, detail)
    values (v_liq.id, 'CREATED', v_uid, jsonb_build_object('weekStart', v_week_start, 'weekEnd', v_week_end));
  else
    select * into v_liq from public.weekly_liquidations
    where seller_id = p_seller_id and week_start_date = v_week_start
    for update;
  end if;

  if v_liq.status <> 'DRAFT' then
    return jsonb_build_object('ok', true, 'liquidationId', v_liq.id, 'status', v_liq.status, 'created', v_created);
  end if;

  with claim as (
    update public.sale_commissions
    set liquidation_id = v_liq.id, updated_at = now()
    where seller_id = p_seller_id
      and status = 'ELIGIBLE'
      and liquidation_id is null
      and eligible_at >= v_week_start::timestamptz
      and eligible_at < (v_week_end + 1)::timestamptz
    returning id
  )
  select count(*) into v_claimed_count from claim;

  update public.weekly_liquidations
  set commissions_subtotal_cents = (select coalesce(sum(final_commission_cents), 0) from public.sale_commissions where liquidation_id = v_liq.id),
      total_to_pay_cents = (select coalesce(sum(final_commission_cents), 0) from public.sale_commissions where liquidation_id = v_liq.id) + adjustments_total_cents,
      updated_at = now()
  where id = v_liq.id
  returning * into v_liq;

  if v_claimed_count > 0 then
    insert into public.weekly_liquidation_events (liquidation_id, event_type, actor_id, detail)
    values (v_liq.id, 'ITEMS_CLAIMED', v_uid, jsonb_build_object('claimedCount', v_claimed_count));
  end if;

  return jsonb_build_object(
    'ok', true, 'liquidationId', v_liq.id, 'status', v_liq.status, 'created', v_created,
    'claimedCount', v_claimed_count, 'subtotalCents', v_liq.commissions_subtotal_cents, 'totalCents', v_liq.total_to_pay_cents
  );
end;
$$;
revoke all on function public.admin_liquidation_create_draft(uuid, date) from public, anon;
grant execute on function public.admin_liquidation_create_draft(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. admin_liquidation_refresh — re-reclama comisiones ELIGIBLE nuevas sobre
--    una liquidación DRAFT ya existente (p. ej. una venta se pagó después de
--    crear el borrador). Bloqueado si ya no es DRAFT.
-- ---------------------------------------------------------------------------
create or replace function public.admin_liquidation_refresh(p_liquidation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid           uuid := auth.uid();
  v_liq           public.weekly_liquidations;
  v_claimed_count int := 0;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  select * into v_liq from public.weekly_liquidations where id = p_liquidation_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if v_liq.status <> 'DRAFT' then
    return jsonb_build_object('ok', false, 'code', 'NOT_DRAFT');
  end if;

  with claim as (
    update public.sale_commissions
    set liquidation_id = v_liq.id, updated_at = now()
    where seller_id = v_liq.seller_id
      and status = 'ELIGIBLE'
      and liquidation_id is null
      and eligible_at >= v_liq.week_start_date::timestamptz
      and eligible_at < (v_liq.week_end_date + 1)::timestamptz
    returning id
  )
  select count(*) into v_claimed_count from claim;

  update public.weekly_liquidations
  set commissions_subtotal_cents = (select coalesce(sum(final_commission_cents), 0) from public.sale_commissions where liquidation_id = v_liq.id),
      total_to_pay_cents = (select coalesce(sum(final_commission_cents), 0) from public.sale_commissions where liquidation_id = v_liq.id) + adjustments_total_cents,
      updated_at = now()
  where id = v_liq.id
  returning * into v_liq;

  if v_claimed_count > 0 then
    insert into public.weekly_liquidation_events (liquidation_id, event_type, actor_id, detail)
    values (v_liq.id, 'ITEMS_CLAIMED', v_uid, jsonb_build_object('claimedCount', v_claimed_count));
  end if;

  return jsonb_build_object(
    'ok', true, 'claimedCount', v_claimed_count,
    'subtotalCents', v_liq.commissions_subtotal_cents, 'totalCents', v_liq.total_to_pay_cents
  );
end;
$$;
revoke all on function public.admin_liquidation_refresh(uuid) from public, anon;
grant execute on function public.admin_liquidation_refresh(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. admin_liquidation_add_adjustment — bono/ajuste manual, entidad separada.
--    Permitido en DRAFT y APPROVED; bloqueado una vez PAID (inmutabilidad).
-- ---------------------------------------------------------------------------
create or replace function public.admin_liquidation_add_adjustment(
  p_liquidation_id uuid, p_type text, p_amount_cents bigint, p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_liq    public.weekly_liquidations;
  v_type   text := upper(btrim(coalesce(p_type, '')));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;
  if v_type not in ('BONO', 'AJUSTE_POSITIVO', 'AJUSTE_NEGATIVO') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_TYPE');
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_AMOUNT');
  end if;
  if v_reason is null then
    return jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
  end if;

  select * into v_liq from public.weekly_liquidations where id = p_liquidation_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if v_liq.status = 'PAID' then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_PAID');
  end if;

  insert into public.weekly_liquidation_adjustments (liquidation_id, adjustment_type, amount_cents, reason, created_by)
  values (p_liquidation_id, v_type, p_amount_cents, v_reason, v_uid);

  update public.weekly_liquidations
  set adjustments_total_cents = (
        select coalesce(sum(case when adjustment_type = 'AJUSTE_NEGATIVO' then -amount_cents else amount_cents end), 0)
        from public.weekly_liquidation_adjustments where liquidation_id = p_liquidation_id
      ),
      updated_at = now()
  where id = p_liquidation_id;

  update public.weekly_liquidations
  set total_to_pay_cents = commissions_subtotal_cents + adjustments_total_cents
  where id = p_liquidation_id
  returning * into v_liq;

  insert into public.weekly_liquidation_events (liquidation_id, event_type, actor_id, detail)
  values (p_liquidation_id, 'ADJUSTMENT_ADDED', v_uid, jsonb_build_object('type', v_type, 'amountCents', p_amount_cents, 'reason', v_reason));

  return jsonb_build_object('ok', true, 'adjustmentsCents', v_liq.adjustments_total_cents, 'totalCents', v_liq.total_to_pay_cents);
end;
$$;
revoke all on function public.admin_liquidation_add_adjustment(uuid, text, bigint, text) from public, anon;
grant execute on function public.admin_liquidation_add_adjustment(uuid, text, bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. admin_liquidation_approve — DRAFT → APPROVED. Congela qué comisiones
--     componen esta liquidación (ya no se reclaman más al refrescar).
-- ---------------------------------------------------------------------------
create or replace function public.admin_liquidation_approve(p_liquidation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_liq public.weekly_liquidations;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  select * into v_liq from public.weekly_liquidations where id = p_liquidation_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if v_liq.status <> 'DRAFT' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATUS');
  end if;

  update public.weekly_liquidations
  set status = 'APPROVED', approved_at = now(), approved_by = v_uid, updated_at = now()
  where id = p_liquidation_id;

  insert into public.weekly_liquidation_events (liquidation_id, event_type, actor_id)
  values (p_liquidation_id, 'APPROVED', v_uid);

  return jsonb_build_object('ok', true, 'status', 'APPROVED');
end;
$$;
revoke all on function public.admin_liquidation_approve(uuid) from public, anon;
grant execute on function public.admin_liquidation_approve(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. admin_liquidation_mark_paid — APPROVED → PAID. Persiste paid_at/
--     paid_by/payment_reference; a partir de aquí todo queda inmutable
--     (incl. ajustes, bloqueados en admin_liquidation_add_adjustment).
-- ---------------------------------------------------------------------------
create or replace function public.admin_liquidation_mark_paid(p_liquidation_id uuid, p_payment_reference text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_liq public.weekly_liquidations;
  v_ref text := nullif(btrim(coalesce(p_payment_reference, '')), '');
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  select * into v_liq from public.weekly_liquidations where id = p_liquidation_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if v_liq.status <> 'APPROVED' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATUS');
  end if;

  update public.weekly_liquidations
  set status = 'PAID', paid_at = now(), paid_by = v_uid, payment_reference = v_ref, updated_at = now()
  where id = p_liquidation_id;

  insert into public.weekly_liquidation_events (liquidation_id, event_type, actor_id, detail)
  values (p_liquidation_id, 'PAID', v_uid, jsonb_build_object('paymentReference', v_ref));

  return jsonb_build_object('ok', true, 'status', 'PAID');
end;
$$;
revoke all on function public.admin_liquidation_mark_paid(uuid, text) from public, anon;
grant execute on function public.admin_liquidation_mark_paid(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 12. admin_liquidation_detail — cabecera + actividad de la semana (viva,
--     por sale_date) + items de comisión reclamados + ajustes.
-- ---------------------------------------------------------------------------
create or replace function public.admin_liquidation_detail(p_liquidation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_liq public.weekly_liquidations;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  select * into v_liq from public.weekly_liquidations where id = p_liquidation_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  return jsonb_build_object(
    'ok', true,
    'liquidation', jsonb_build_object(
      'id', v_liq.id, 'sellerId', v_liq.seller_id,
      'sellerName', (select full_name from public.profiles where id = v_liq.seller_id),
      'weekStart', v_liq.week_start_date, 'weekEnd', v_liq.week_end_date,
      'status', v_liq.status,
      'subtotalCents', v_liq.commissions_subtotal_cents,
      'adjustmentsCents', v_liq.adjustments_total_cents,
      'totalCents', v_liq.total_to_pay_cents,
      'approvedAt', v_liq.approved_at,
      'approvedByName', (select full_name from public.profiles where id = v_liq.approved_by),
      'paidAt', v_liq.paid_at,
      'paidByName', (select full_name from public.profiles where id = v_liq.paid_by),
      'paymentReference', v_liq.payment_reference,
      'createdAt', v_liq.created_at
    ),
    'activity', jsonb_build_object(
      'pending', coalesce((
        select jsonb_agg(jsonb_build_object(
          'saleId', s.id, 'saleNumber', s.sale_number,
          'saleDate', coalesce(s.sale_date, s.created_at::date),
          'buyerName', (select nullif(btrim(coalesce(sp.first_name, '') || ' ' || coalesce(sp.last_name, '')), '')
                        from public.sale_parties sp where sp.sale_id = s.id and sp.party_role = 'PRIMARY_BUYER'),
          'saleTotalCents', s.sale_total_cents
        ) order by s.created_at)
        from public.sales s
        where s.seller_id = v_liq.seller_id and s.operation_type = 'CUBA' and s.status = 'PENDING'
          and coalesce(s.sale_date, s.created_at::date) between v_liq.week_start_date and v_liq.week_end_date
      ), '[]'::jsonb),
      'sold', coalesce((
        select jsonb_agg(jsonb_build_object(
          'saleId', s.id, 'saleNumber', s.sale_number,
          'saleDate', coalesce(s.sale_date, s.created_at::date),
          'buyerName', (select nullif(btrim(coalesce(sp.first_name, '') || ' ' || coalesce(sp.last_name, '')), '')
                        from public.sale_parties sp where sp.sale_id = s.id and sp.party_role = 'PRIMARY_BUYER'),
          'saleTotalCents', s.sale_total_cents,
          'commissionPendingCents', (select coalesce(sum(sc.final_commission_cents), 0) from public.sale_commissions sc where sc.sale_id = s.id and sc.status = 'PENDING')
        ) order by s.created_at)
        from public.sales s
        where s.seller_id = v_liq.seller_id and s.operation_type = 'CUBA' and s.status = 'SOLD'
          and coalesce(s.sale_date, s.created_at::date) between v_liq.week_start_date and v_liq.week_end_date
      ), '[]'::jsonb),
      'paid', coalesce((
        select jsonb_agg(jsonb_build_object(
          'saleId', s.id, 'saleNumber', s.sale_number,
          'saleDate', coalesce(s.sale_date, s.created_at::date),
          'buyerName', (select nullif(btrim(coalesce(sp.first_name, '') || ' ' || coalesce(sp.last_name, '')), '')
                        from public.sale_parties sp where sp.sale_id = s.id and sp.party_role = 'PRIMARY_BUYER'),
          'saleTotalCents', s.sale_total_cents
        ) order by s.created_at)
        from public.sales s
        where s.seller_id = v_liq.seller_id and s.operation_type = 'CUBA' and s.status = 'PAID'
          and coalesce(s.sale_date, s.created_at::date) between v_liq.week_start_date and v_liq.week_end_date
      ), '[]'::jsonb)
    ),
    'commissionItems', coalesce((
      select jsonb_agg(jsonb_build_object(
        'saleCommissionId', sc.id, 'saleId', sc.sale_id, 'saleNumber', s.sale_number,
        'productName', su.product_name_snapshot, 'variantName', su.variant_snapshot,
        'referencePriceCents', sc.reference_price_cents, 'salePriceCents', sc.sale_price_cents,
        'priceDifferenceCents', sc.price_difference_cents,
        'baseCommissionCents', sc.base_commission_cents,
        'sellerDifferenceShareCents', sc.seller_difference_share_cents,
        'finalCommissionCents', sc.final_commission_cents,
        'eligibleAt', sc.eligible_at
      ) order by sc.eligible_at)
      from public.sale_commissions sc
      join public.sales s on s.id = sc.sale_id
      join public.sale_units su on su.id = sc.sale_unit_id
      where sc.liquidation_id = v_liq.id
    ), '[]'::jsonb),
    'adjustments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'type', a.adjustment_type, 'amountCents', a.amount_cents,
        'reason', a.reason, 'createdByName', (select full_name from public.profiles where id = a.created_by),
        'createdAt', a.created_at
      ) order by a.created_at)
      from public.weekly_liquidation_adjustments a
      where a.liquidation_id = v_liq.id
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.admin_liquidation_detail(uuid) from public, anon;
grant execute on function public.admin_liquidation_detail(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 13. Seller — solo lectura de sus propias liquidaciones APPROVED/PAID
--     (DRAFT es un estado de trabajo interno del admin; nunca se expone).
-- ---------------------------------------------------------------------------
create or replace function public.seller_liquidation_list()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;

  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(jsonb_build_object(
      'liquidationId', wl.id, 'weekStart', wl.week_start_date, 'weekEnd', wl.week_end_date,
      'status', wl.status, 'subtotalCents', wl.commissions_subtotal_cents,
      'adjustmentsCents', wl.adjustments_total_cents, 'totalCents', wl.total_to_pay_cents,
      'paidAt', wl.paid_at
    ) order by wl.week_start_date desc)
    from public.weekly_liquidations wl
    where wl.seller_id = v_uid and wl.status in ('APPROVED', 'PAID')
  ), '[]'::jsonb));
end;
$$;
revoke all on function public.seller_liquidation_list() from public, anon;
grant execute on function public.seller_liquidation_list() to authenticated;

create or replace function public.seller_liquidation_detail(p_liquidation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_uid uuid := auth.uid();
  v_liq public.weekly_liquidations;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;

  select * into v_liq from public.weekly_liquidations
  where id = p_liquidation_id and seller_id = v_uid and status in ('APPROVED', 'PAID');
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  return jsonb_build_object(
    'ok', true,
    'liquidation', jsonb_build_object(
      'id', v_liq.id, 'weekStart', v_liq.week_start_date, 'weekEnd', v_liq.week_end_date,
      'status', v_liq.status,
      'subtotalCents', v_liq.commissions_subtotal_cents,
      'adjustmentsCents', v_liq.adjustments_total_cents,
      'totalCents', v_liq.total_to_pay_cents,
      'paidAt', v_liq.paid_at, 'paymentReference', v_liq.payment_reference
    ),
    'activity', jsonb_build_object(
      'pending', coalesce((
        select jsonb_agg(jsonb_build_object(
          'saleId', s.id, 'saleNumber', s.sale_number,
          'saleDate', coalesce(s.sale_date, s.created_at::date),
          'buyerName', (select nullif(btrim(coalesce(sp.first_name, '') || ' ' || coalesce(sp.last_name, '')), '')
                        from public.sale_parties sp where sp.sale_id = s.id and sp.party_role = 'PRIMARY_BUYER'),
          'saleTotalCents', s.sale_total_cents
        ) order by s.created_at)
        from public.sales s
        where s.seller_id = v_liq.seller_id and s.operation_type = 'CUBA' and s.status = 'PENDING'
          and coalesce(s.sale_date, s.created_at::date) between v_liq.week_start_date and v_liq.week_end_date
      ), '[]'::jsonb),
      'sold', coalesce((
        select jsonb_agg(jsonb_build_object(
          'saleId', s.id, 'saleNumber', s.sale_number,
          'saleDate', coalesce(s.sale_date, s.created_at::date),
          'buyerName', (select nullif(btrim(coalesce(sp.first_name, '') || ' ' || coalesce(sp.last_name, '')), '')
                        from public.sale_parties sp where sp.sale_id = s.id and sp.party_role = 'PRIMARY_BUYER'),
          'saleTotalCents', s.sale_total_cents,
          'commissionPendingCents', (select coalesce(sum(sc.final_commission_cents), 0) from public.sale_commissions sc where sc.sale_id = s.id and sc.status = 'PENDING')
        ) order by s.created_at)
        from public.sales s
        where s.seller_id = v_liq.seller_id and s.operation_type = 'CUBA' and s.status = 'SOLD'
          and coalesce(s.sale_date, s.created_at::date) between v_liq.week_start_date and v_liq.week_end_date
      ), '[]'::jsonb),
      'paid', coalesce((
        select jsonb_agg(jsonb_build_object(
          'saleId', s.id, 'saleNumber', s.sale_number,
          'saleDate', coalesce(s.sale_date, s.created_at::date),
          'buyerName', (select nullif(btrim(coalesce(sp.first_name, '') || ' ' || coalesce(sp.last_name, '')), '')
                        from public.sale_parties sp where sp.sale_id = s.id and sp.party_role = 'PRIMARY_BUYER'),
          'saleTotalCents', s.sale_total_cents
        ) order by s.created_at)
        from public.sales s
        where s.seller_id = v_liq.seller_id and s.operation_type = 'CUBA' and s.status = 'PAID'
          and coalesce(s.sale_date, s.created_at::date) between v_liq.week_start_date and v_liq.week_end_date
      ), '[]'::jsonb)
    ),
    'commissionItems', coalesce((
      select jsonb_agg(jsonb_build_object(
        'saleId', sc.sale_id, 'saleNumber', s.sale_number,
        'productName', su.product_name_snapshot, 'variantName', su.variant_snapshot,
        'referencePriceCents', sc.reference_price_cents, 'salePriceCents', sc.sale_price_cents,
        'priceDifferenceCents', sc.price_difference_cents,
        'baseCommissionCents', sc.base_commission_cents,
        'sellerDifferenceShareCents', sc.seller_difference_share_cents,
        'finalCommissionCents', sc.final_commission_cents,
        'eligibleAt', sc.eligible_at
      ) order by sc.eligible_at)
      from public.sale_commissions sc
      join public.sales s on s.id = sc.sale_id
      join public.sale_units su on su.id = sc.sale_unit_id
      where sc.liquidation_id = v_liq.id
    ), '[]'::jsonb),
    'adjustments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'type', a.adjustment_type, 'amountCents', a.amount_cents, 'reason', a.reason, 'createdAt', a.created_at
      ) order by a.created_at)
      from public.weekly_liquidation_adjustments a
      where a.liquidation_id = v_liq.id
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.seller_liquidation_detail(uuid) from public, anon;
grant execute on function public.seller_liquidation_detail(uuid) to authenticated;
