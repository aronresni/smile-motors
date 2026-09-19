-- ===========================================================================
-- LIQUIDACIÓN SEMANAL — límites de semana en la ZONA HORARIA DEL
-- CONCESIONARIO (America/New_York), no en UTC.
--
-- Bug corregido: `(week_end_date + 1)::timestamptz` y `eligible_at >=
-- week_start::timestamptz` (introducidos en 20260910300000/300100)
-- interpretaban esas fechas en la zona horaria de la SESIÓN de Postgres
-- (UTC en Supabase) — no en la del negocio. Un domingo 10:30pm hora del Este
-- ya es lunes de madrugada en UTC, así que una comisión que se vuelve
-- ELIGIBLE esa noche habría caído (incorrectamente) en la semana SIGUIENTE,
-- y una liquidación se habría considerado "cerrada" varias horas antes de
-- que terminara el domingo real del negocio.
--
-- FUENTE ÚNICA DE VERDAD (una sola vez, reusada en todos lados):
--   - `_dealer_timezone()`      → el nombre de zona IANA ('America/New_York').
--   - `_liquidation_week_of_instant(ts)` → qué lunes (week_start_date) le
--     corresponde a un instante absoluto, según el día calendario LOCAL del
--     concesionario.
--   - `_liquidation_week_open_at(week_start)`  → instante exacto (UTC) en que
--     esa semana ABRE: lunes 00:00:00 hora del concesionario.
--   - `_liquidation_week_close_at(week_start)` → instante exacto en que esa
--     semana CIERRA: el lunes SIGUIENTE 00:00:00 hora del concesionario.
--
-- `AT TIME ZONE 'America/New_York'` usa la base de datos de zonas IANA que
-- trae Postgres — resuelve EST/EDT y la transición de horario de verano
-- automáticamente según la fecha real, nunca un offset fijo (`UTC-4`/`UTC-5`
-- quedarían mal la mitad del año). `_liquidation_week_start(date)` (cálculo
-- de calendario puro, sin zona horaria) NO cambia: encontrar el lunes de una
-- fecha ya conocida es aritmética de calendario, independiente de zona
-- horaria — el problema estaba solo en la conversión fecha↔instante.
--
-- `sale_date` (actividad de la semana) es una columna `date` pura, sin hora
-- — ya representa el día calendario de negocio tal cual el vendedor lo
-- registró. Comparar `date` contra `date` (`between week_start_date and
-- week_end_date`) no involucra ninguna conversión de zona horaria: sigue
-- siendo correcto sin cambios.
--
-- Datos existentes: `weekly_liquidations` está VACÍA en producción (0 filas,
-- verificado antes de escribir esta migración) — no hay ninguna liquidación
-- histórica que reinterpretar ni reescribir. No se cambia ningún
-- `eligible_at`, `paid_at`, monto de comisión, ni el ciclo de vida.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Configuración — único punto para cambiar la zona horaria del negocio.
-- ---------------------------------------------------------------------------
create or replace function public._dealer_timezone()
returns text
language sql
immutable
as $$
  select 'America/New_York'::text;
$$;
revoke all on function public._dealer_timezone() from public, anon;
comment on function public._dealer_timezone() is
  'Única fuente de verdad de la zona horaria de negocio para límites de semana de Liquidación Semanal. Cambiar SOLO aquí.';

-- ---------------------------------------------------------------------------
-- 2. Instante → semana (para decidir a qué semana pertenece un eligible_at).
-- ---------------------------------------------------------------------------
create or replace function public._liquidation_week_of_instant(p_ts timestamptz)
returns date
language sql
stable
as $$
  select public._liquidation_week_start((p_ts at time zone public._dealer_timezone())::date);
$$;
revoke all on function public._liquidation_week_of_instant(timestamptz) from public, anon;

-- ---------------------------------------------------------------------------
-- 3. Semana → instante de apertura/cierre (para el gate de aprobación y para
--    el rango de reclamo de comisiones ELIGIBLE).
-- ---------------------------------------------------------------------------
create or replace function public._liquidation_week_open_at(p_week_start date)
returns timestamptz
language sql
stable
as $$
  select (p_week_start::timestamp) at time zone public._dealer_timezone();
$$;
revoke all on function public._liquidation_week_open_at(date) from public, anon;

create or replace function public._liquidation_week_close_at(p_week_start date)
returns timestamptz
language sql
stable
as $$
  select public._liquidation_week_open_at(p_week_start + 7);
$$;
revoke all on function public._liquidation_week_close_at(date) from public, anon;

-- ---------------------------------------------------------------------------
-- 4. admin_liquidation_current_week — "hoy" del concesionario, para que el
--    frontend nunca tenga que adivinar la semana actual con el reloj del
--    navegador/servidor Node (que puede correr en cualquier zona horaria).
--    Reusa el mismo helper que todo lo demás — no es un cálculo aparte.
-- ---------------------------------------------------------------------------
create or replace function public.admin_liquidation_current_week()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_week_start date;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;
  v_week_start := public._liquidation_week_of_instant(now());
  return jsonb_build_object('ok', true, 'weekStart', v_week_start, 'weekEnd', v_week_start + 6);
end;
$$;
revoke all on function public.admin_liquidation_current_week() from public, anon;
grant execute on function public.admin_liquidation_current_week() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. admin_liquidation_create_draft — reclamo de comisiones ELIGIBLE por
--    ventana de instante dealer-timezone (antes: cast UTC crudo).
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
      and eligible_at >= public._liquidation_week_open_at(v_week_start)
      and eligible_at < public._liquidation_week_close_at(v_week_start)
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
-- 6. admin_liquidation_refresh — mismo ajuste de ventana.
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
      and eligible_at >= public._liquidation_week_open_at(v_liq.week_start_date)
      and eligible_at < public._liquidation_week_close_at(v_liq.week_start_date)
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
-- 7. admin_liquidation_approve — el gate WEEK_NOT_CLOSED ahora usa el
--    instante de cierre en zona horaria del concesionario.
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
  if now() < public._liquidation_week_close_at(v_liq.week_start_date) then
    return jsonb_build_object(
      'ok', false, 'code', 'WEEK_NOT_CLOSED',
      'weekEnd', v_liq.week_end_date,
      'closesAt', public._liquidation_week_close_at(v_liq.week_start_date)
    );
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
-- 8. admin_liquidation_mark_paid — mismo gate (defensa en profundidad).
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
  if now() < public._liquidation_week_close_at(v_liq.week_start_date) then
    return jsonb_build_object(
      'ok', false, 'code', 'WEEK_NOT_CLOSED',
      'weekEnd', v_liq.week_end_date,
      'closesAt', public._liquidation_week_close_at(v_liq.week_start_date)
    );
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
-- 9. admin_liquidation_detail — weekClosed/closesAt en zona del concesionario.
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
      'createdAt', v_liq.created_at,
      'weekClosed', now() >= public._liquidation_week_close_at(v_liq.week_start_date),
      'closesAt', public._liquidation_week_close_at(v_liq.week_start_date)
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
-- 10. admin_liquidation_week_list — default "hoy" y weekClosed en zona del
--     concesionario; ventana de comisiones ELIGIBLE sin reclamar, igual.
-- ---------------------------------------------------------------------------
create or replace function public.admin_liquidation_week_list(p_week_start date default null)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_week_start date := public._liquidation_week_start(coalesce(p_week_start, public._liquidation_week_of_instant(now())));
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
    'weekClosed', now() >= public._liquidation_week_close_at(v_week_start),
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
            and sc.eligible_at >= public._liquidation_week_open_at(v_week_start)
            and sc.eligible_at < public._liquidation_week_close_at(v_week_start)
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
