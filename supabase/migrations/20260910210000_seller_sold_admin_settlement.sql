-- ===========================================================================
-- CORRECCIÓN DE REGLA DE NEGOCIO: quién controla cada transición + cobro
-- separado del estado comercial.
--
-- Reemplaza el flujo anterior (admin aprueba PENDING→SOLD; PAID se detecta
-- solo automáticamente) por el flujo real:
--
--   DRAFT --(vendedor solicita)--> PENDING
--   PENDING --(VENDEDOR, solo si los contratos obligatorios están firmados)--> SOLD
--   SOLD --(ADMIN revisa el cierre)--> sigue SOLD con cobro pendiente, o -> PAID
--
-- Sigue habiendo exactamente 3 estados comerciales "reales" además de DRAFT/
-- CANCELLED: PENDING, SOLD, PAID (`sales.status`, SIN CAMBIOS en su dominio).
-- El cobro ("¿ya se recibió el dinero?") es un concepto DISTINTO que se
-- modela en columnas nuevas y separadas (`sales.settlement_status` +
-- snapshot de auditoría) — nunca se sobrecarga `sales.status` con esto.
--
-- - `sold_at`/`sold_by` ahora los escribe el VENDEDOR (antes: admin).
-- - Ya NO existe ninguna transición automática a PAID. Un admin humano
--   siempre debe confirmarla explícitamente, aunque el sistema calcule que
--   la liquidación ya está completa (`readyForPaid`).
-- - `payment_methods.requires_signed_contract` (ya existía) es la fuente de
--   verdad server-side de qué financieras bloquean PENDING→SOLD.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. `sales` — estado de cobro, SEPARADO del estado comercial.
-- ---------------------------------------------------------------------------
alter table public.sales
  add column if not exists settlement_status        text
    check (settlement_status in ('PENDING_COLLECTION', 'PAID')),
  add column if not exists closing_reviewed_at       timestamptz,
  add column if not exists closing_reviewed_by       uuid references public.profiles (id) on delete set null,
  add column if not exists amount_collected_cents    bigint,
  add column if not exists amount_outstanding_cents  bigint;

comment on column public.sales.sold_at is
  'Cuándo el VENDEDOR pasó la venta a SOLD (PENDING → SOLD, contratos obligatorios ya firmados).';
comment on column public.sales.sold_by is
  'Vendedor que marcó la venta como vendida. Antes (antes de esta migración) era el admin que aprobaba.';
comment on column public.sales.settlement_status is
  'Estado de COBRO, independiente de sales.status: PENDING_COLLECTION | PAID. NULL mientras la venta no es SOLD/PAID.';
comment on column public.sales.closing_reviewed_at is
  'Última vez que un admin revisó el cierre de una venta SOLD (confirmó cobro pendiente o pagó).';

-- Backfill de datos reales existentes: toda venta ya SOLD queda con cobro
-- pendiente (nunca se asume que ya se cobró); toda venta ya PAID queda con
-- el histórico coherente (monto cobrado = total, pendiente = 0).
update public.sales set settlement_status = 'PENDING_COLLECTION' where status = 'SOLD';
update public.sales set
  settlement_status = 'PAID',
  amount_collected_cents = coalesce(sale_total_cents, 0),
  amount_outstanding_cents = 0
where status = 'PAID';

-- ---------------------------------------------------------------------------
-- 2. sale_settlement_amounts — cálculo interno (NUNCA expuesto directo al
--    cliente: no valida propiedad de la venta). Solo lo llaman otras
--    funciones SECURITY DEFINER de este archivo. Fuente única de verdad de
--    "cuánto se cobró de verdad" — financiación cuenta NETO ACREDITADO
--    (nunca bruto, nunca solo firmado); pagos directos cuentan solo
--    liquidado (`sale_payment_allocations.settlement_status = 'SETTLED'`).
-- ---------------------------------------------------------------------------
create or replace function public.sale_settlement_amounts(p_sale_id uuid)
returns table (collected_cents bigint, all_covered boolean)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_collected   bigint := 0;
  v_all_covered boolean := true;
  v_has_rows    boolean := false;
  v_alloc       record;
begin
  for v_alloc in
    select a.id, a.net_amount_cents, a.settlement_status, m.method_type
    from public.sale_payment_allocations a
    join public.payment_methods m on m.id = a.payment_method_id
    where a.sale_id = p_sale_id
  loop
    v_has_rows := true;
    if v_alloc.method_type = 'FINANCING' then
      if exists (
        select 1 from public.sale_financing_contracts c
        where c.payment_allocation_id = v_alloc.id and c.status = 'ACCREDITED'
      ) then
        v_collected := v_collected + v_alloc.net_amount_cents;
      else
        v_all_covered := false;
      end if;
    else
      if v_alloc.settlement_status = 'SETTLED' then
        v_collected := v_collected + v_alloc.net_amount_cents;
      else
        v_all_covered := false;
      end if;
    end if;
  end loop;

  if not v_has_rows then
    v_all_covered := false;
  end if;

  return query select v_collected, v_all_covered;
end;
$$;
revoke all on function public.sale_settlement_amounts(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. mark_sale_sold — PENDING → SOLD, hecho por el VENDEDOR dueño de la
--    venta (reemplaza `approve_sale_review`, que era de admin). Vuelve a
--    validar TODO server-side: nunca confía en un checkbox del navegador.
-- ---------------------------------------------------------------------------
create or replace function public.mark_sale_sold(p_sale_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_sale   public.sales;
  v_errors text[];
  v_unit   record;
  v_req    record;
  v_unsigned       text[] := array[]::text[];
  v_units_total    bigint;
  v_extras_total   bigint;
  v_delivery_total bigint;
  v_sale_total     bigint;
  v_number text;
  v_year   text := to_char(current_date, 'YYYY');
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not exists (select 1 from public.profiles where id = v_uid and is_active) then
    return jsonb_build_object('ok', false, 'code', 'PROFILE_INACTIVE');
  end if;

  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'SALE_NOT_FOUND');
  end if;
  if v_sale.seller_id <> v_uid then
    return jsonb_build_object('ok', false, 'code', 'NOT_OWNER');
  end if;
  if v_sale.operation_type <> 'CUBA' then
    return jsonb_build_object('ok', false, 'code', 'NOT_CUBA');
  end if;

  if v_sale.status in ('SOLD', 'PAID') then
    return jsonb_build_object('ok', true, 'alreadySold', true,
      'saleId', v_sale.id, 'saleNumber', v_sale.sale_number, 'status', v_sale.status);
  end if;
  if v_sale.status <> 'PENDING' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATUS');
  end if;

  v_errors := public.validate_cuba_sale_for_review(p_sale_id);
  if array_length(v_errors, 1) is not null then
    return jsonb_build_object('ok', false, 'code', 'VALIDATION_FAILED', 'errors', to_jsonb(v_errors));
  end if;

  -- Contratos de financiación OBLIGATORIOS (payment_methods.requires_signed_contract):
  -- deben estar FIRMADOS o ACREDITADOS. Se revisa contra los registros reales
  -- de `sale_financing_contracts`, nunca contra lo que declare el navegador.
  for v_req in
    select m.name as provider_name, c.status as contract_status
    from public.sale_payment_allocations a
    join public.payment_methods m on m.id = a.payment_method_id
    left join public.sale_financing_contracts c on c.payment_allocation_id = a.id
    where a.sale_id = p_sale_id and m.requires_signed_contract
  loop
    if v_req.contract_status is null or v_req.contract_status not in ('SIGNED', 'ACCREDITED') then
      v_unsigned := array_append(v_unsigned, v_req.provider_name);
    end if;
  end loop;

  if array_length(v_unsigned, 1) is not null then
    return jsonb_build_object('ok', false, 'code', 'CONTRACT_UNSIGNED', 'providers', to_jsonb(v_unsigned));
  end if;

  select coalesce(sum(agreed_price_cents), 0) into v_units_total
    from public.sale_units where sale_id = p_sale_id;
  select coalesce(sum(greatest(1, quantity) * greatest(0, unit_price_cents)), 0) into v_extras_total
    from public.sale_extras where sale_id = p_sale_id;
  v_delivery_total := 0;
  v_sale_total := v_units_total + v_extras_total + v_delivery_total;

  v_number := v_sale.sale_number;
  if v_number is null then
    v_number := 'VTA-' || v_year || '-' || lpad(nextval('public.sale_number_seq')::text, 6, '0');
  end if;

  for v_unit in
    select id from public.sale_units
    where sale_id = p_sale_id and tracking_code is null
    order by position
  loop
    update public.sale_units
    set tracking_code = 'CU-' || v_year || '-'
        || lpad(nextval('public.sale_unit_tracking_seq')::text, 6, '0')
    where id = v_unit.id;
  end loop;

  update public.sales set
    status               = 'SOLD',
    sold_at              = now(),
    sold_by              = v_uid,
    sale_number          = v_number,
    units_total_cents    = v_units_total,
    extras_total_cents   = v_extras_total,
    delivery_total_cents = v_delivery_total,
    sale_total_cents     = v_sale_total,
    settlement_status    = 'PENDING_COLLECTION'
  where id = p_sale_id;

  insert into public.sale_status_history (sale_id, from_status, to_status, changed_by)
  values (p_sale_id, 'PENDING', 'SOLD', v_uid);

  return jsonb_build_object('ok', true, 'saleId', p_sale_id, 'saleNumber', v_number,
    'status', 'SOLD', 'saleTotalCents', v_sale_total);
end;
$$;
revoke all on function public.mark_sale_sold(uuid) from public, anon;
grant execute on function public.mark_sale_sold(uuid) to authenticated;

-- `approve_sale_review` (admin aprobaba PENDING→SOLD) queda reemplazada:
-- ahora es el vendedor quien marca la venta como vendida.
drop function if exists public.approve_sale_review(uuid);

-- ---------------------------------------------------------------------------
-- 4. admin_confirm_sale_closing — Opción A: "CIERRE PENDIENTE A COBRAR".
--    Registra que un admin revisó una venta SOLD (auditoría humana), guarda
--    la foto de cuánto está cobrado/pendiente en ese momento. NO cambia
--    `sales.status`.
-- ---------------------------------------------------------------------------
create or replace function public.admin_confirm_sale_closing(p_sale_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid         uuid := auth.uid();
  v_sale        public.sales;
  v_collected   bigint;
  v_covered     boolean;
  v_outstanding bigint;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'SALE_NOT_FOUND');
  end if;
  if v_sale.status not in ('SOLD', 'PAID') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATUS');
  end if;

  select collected_cents, all_covered into v_collected, v_covered
    from public.sale_settlement_amounts(p_sale_id);
  v_outstanding := greatest(0, coalesce(v_sale.sale_total_cents, 0) - v_collected);

  update public.sales set
    closing_reviewed_at      = now(),
    closing_reviewed_by      = v_uid,
    amount_collected_cents   = v_collected,
    amount_outstanding_cents = v_outstanding,
    settlement_status        = case when v_sale.status = 'PAID' then 'PAID' else 'PENDING_COLLECTION' end
  where id = p_sale_id;

  return jsonb_build_object('ok', true, 'saleId', p_sale_id,
    'collectedCents', v_collected, 'outstandingCents', v_outstanding, 'readyForPaid', v_covered);
end;
$$;
revoke all on function public.admin_confirm_sale_closing(uuid) from public, anon;
grant execute on function public.admin_confirm_sale_closing(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. admin_mark_sale_paid — Opción B: SOLD → PAID. SIEMPRE una acción humana
--    de un admin (nunca automática, aunque el cálculo diga que ya se cubrió
--    todo). Vuelve a calcular la cobertura server-side; nunca confía en el
--    front. Reemplaza la implementación anterior (que solo reintentaba el
--    auto-cálculo) por la transición autoritativa real.
-- ---------------------------------------------------------------------------
create or replace function public.admin_mark_sale_paid(p_sale_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_sale      public.sales;
  v_collected bigint;
  v_covered   boolean;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'SALE_NOT_FOUND');
  end if;
  if v_sale.status = 'PAID' then
    return jsonb_build_object('ok', true, 'alreadyPaid', true, 'saleId', p_sale_id, 'status', 'PAID');
  end if;
  if v_sale.status <> 'SOLD' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATUS');
  end if;

  select collected_cents, all_covered into v_collected, v_covered
    from public.sale_settlement_amounts(p_sale_id);

  if not coalesce(v_covered, false)
     or coalesce(v_sale.sale_total_cents, 0) = 0
     or v_collected <> v_sale.sale_total_cents then
    return jsonb_build_object('ok', false, 'code', 'SETTLEMENT_INCOMPLETE',
      'collectedCents', v_collected,
      'outstandingCents', greatest(0, coalesce(v_sale.sale_total_cents, 0) - v_collected));
  end if;

  update public.sales set
    status                    = 'PAID',
    paid_at                   = now(),
    paid_by                   = v_uid,
    settlement_status         = 'PAID',
    amount_collected_cents    = v_collected,
    amount_outstanding_cents  = 0
  where id = p_sale_id;

  insert into public.sale_status_history (sale_id, from_status, to_status, changed_by, reason)
  values (p_sale_id, 'SOLD', 'PAID', v_uid, 'Confirmado por administrador');

  return jsonb_build_object('ok', true, 'saleId', p_sale_id, 'status', 'PAID', 'collectedCents', v_collected);
end;
$$;
revoke all on function public.admin_mark_sale_paid(uuid) from public, anon;
grant execute on function public.admin_mark_sale_paid(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. recompute_sale_paid_status queda ELIMINADA: encarnaba exactamente el
--    comportamiento prohibido (pasar a PAID automáticamente). Las funciones
--    que la llamaban ahora solo devuelven una PISTA de solo lectura
--    (`readyForPaid`) sin tocar `sales.status`.
-- ---------------------------------------------------------------------------
drop function if exists public.recompute_sale_paid_status(uuid, uuid);

create or replace function public.mark_financing_accredited(p_contract_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_contract public.sale_financing_contracts;
  v_ready    boolean;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  select * into v_contract from public.sale_financing_contracts where id = p_contract_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'CONTRACT_NOT_FOUND');
  end if;

  if v_contract.status = 'ACCREDITED' then
    select all_covered into v_ready from public.sale_settlement_amounts(v_contract.sale_id);
    return jsonb_build_object('ok', true, 'alreadyAccredited', true,
      'contractId', p_contract_id, 'status', 'ACCREDITED', 'readyForPaid', coalesce(v_ready, false));
  end if;
  if v_contract.status <> 'SIGNED' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATUS');
  end if;

  update public.sale_financing_contracts set
    status = 'ACCREDITED', accredited_at = now(), accredited_by = v_uid
  where id = p_contract_id;

  insert into public.financing_contract_events (contract_id, from_status, to_status, changed_by, note)
  values (p_contract_id, 'SIGNED', 'ACCREDITED', v_uid, nullif(btrim(coalesce(p_note, '')), ''));

  -- Solo una PISTA de solo lectura para la UI ("lista para marcar pagada");
  -- NUNCA cambia `sales.status`. La transición SOLD → PAID la hace un admin
  -- explícitamente vía `admin_mark_sale_paid`.
  select all_covered into v_ready from public.sale_settlement_amounts(v_contract.sale_id);

  return jsonb_build_object('ok', true, 'contractId', p_contract_id, 'status', 'ACCREDITED',
    'readyForPaid', coalesce(v_ready, false));
end;
$$;
revoke all on function public.mark_financing_accredited(uuid, text) from public, anon;
grant execute on function public.mark_financing_accredited(uuid, text) to authenticated;

create or replace function public.mark_payment_allocation_settled(p_allocation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_alloc  public.sale_payment_allocations;
  v_method public.payment_methods;
  v_ready  boolean;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  select * into v_alloc from public.sale_payment_allocations where id = p_allocation_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'ALLOCATION_NOT_FOUND');
  end if;

  select * into v_method from public.payment_methods where id = v_alloc.payment_method_id;
  if found and v_method.method_type = 'FINANCING' then
    return jsonb_build_object('ok', false, 'code', 'USE_FINANCING_FLOW');
  end if;

  if v_alloc.settlement_status = 'SETTLED' then
    select all_covered into v_ready from public.sale_settlement_amounts(v_alloc.sale_id);
    return jsonb_build_object('ok', true, 'alreadySettled', true,
      'allocationId', p_allocation_id, 'readyForPaid', coalesce(v_ready, false));
  end if;

  update public.sale_payment_allocations set
    settlement_status = 'SETTLED', settled_at = now(), settled_by = v_uid
  where id = p_allocation_id;

  select all_covered into v_ready from public.sale_settlement_amounts(v_alloc.sale_id);

  return jsonb_build_object('ok', true, 'allocationId', p_allocation_id, 'readyForPaid', coalesce(v_ready, false));
end;
$$;
revoke all on function public.mark_payment_allocation_settled(uuid) from public, anon;
grant execute on function public.mark_payment_allocation_settled(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. admin_sales_queue_list — cola de trabajo de admin: reemplaza
--    `admin_pending_sales_list`. Con `p_status = 'PENDING'` lista ventas
--    enviadas a revisión (informativo: el admin ya no aprueba, pero puede
--    devolver a borrador si detecta un problema). Con `p_status = 'SOLD'`
--    lista ventas VENDIDAS con cobro pendiente (`settlement_status =
--    'PENDING_COLLECTION'`) — la cola ACCIONABLE de cierre.
-- ---------------------------------------------------------------------------
create or replace function public.admin_sales_queue_list(
  p_status text default 'PENDING',
  p_limit  int  default 50,
  p_offset int  default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_status text := upper(coalesce(nullif(btrim(p_status), ''), 'PENDING'));
  v_limit  int  := greatest(1, least(coalesce(p_limit, 50), 100));
  v_offset int  := greatest(0, coalesce(p_offset, 0));
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;
  if v_status not in ('PENDING', 'SOLD') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATUS');
  end if;

  return jsonb_build_object(
    'ok', true,
    'status', v_status,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'saleId', s.id,
        'saleNumber', s.sale_number,
        'reviewRequestedAt', s.review_requested_at,
        'soldAt', s.sold_at,
        'sellerName', (select p.full_name from public.profiles p where p.id = s.seller_id),
        'buyerName', (select nullif(btrim(coalesce(sp.first_name, '') || ' ' || coalesce(sp.last_name, '')), '')
                      from public.sale_parties sp
                      where sp.sale_id = s.id and sp.party_role = 'PRIMARY_BUYER'),
        'saleTotalCents', coalesce(s.sale_total_cents, (
          select coalesce(sum(su.agreed_price_cents), 0) from public.sale_units su where su.sale_id = s.id)),
        'unitCount', (select count(*) from public.sale_units su where su.sale_id = s.id),
        'amountOutstandingCents', s.amount_outstanding_cents)
        order by case when v_status = 'PENDING' then s.review_requested_at else s.sold_at end asc nulls last)
      from (
        select * from public.sales
        where operation_type = 'CUBA'
          and (
            (v_status = 'PENDING' and status = 'PENDING')
            or (v_status = 'SOLD' and status = 'SOLD' and coalesce(settlement_status, 'PENDING_COLLECTION') = 'PENDING_COLLECTION')
          )
        order by case when v_status = 'PENDING' then review_requested_at else sold_at end asc nulls last
        limit v_limit offset v_offset
      ) s
    ), '[]'::jsonb),
    'totalCount', (
      select count(*) from public.sales
      where operation_type = 'CUBA'
        and (
          (v_status = 'PENDING' and status = 'PENDING')
          or (v_status = 'SOLD' and status = 'SOLD' and coalesce(settlement_status, 'PENDING_COLLECTION') = 'PENDING_COLLECTION')
        )
    )
  );
end;
$$;
revoke all on function public.admin_sales_queue_list(text, int, int) from public, anon;
grant execute on function public.admin_sales_queue_list(text, int, int) to authenticated;

drop function if exists public.admin_pending_sales_list(int, int);

-- ===========================================================================
-- 8. get_cuba_sale_draft — + `settlement` (vivo, calculado server-side) y
--    `methodRequiresSignedContract` por allocation (para que la UI del
--    vendedor pueda mostrar el checklist de contratos obligatorios).
-- ===========================================================================
create or replace function public.get_cuba_sale_draft(p_sale_id uuid)
returns jsonb
language sql
security invoker
set search_path = public
stable
as $$
  select jsonb_build_object(
    'sale', to_jsonb(s.*),
    'seller', (select jsonb_build_object('id', pr.id, 'fullName', pr.full_name, 'email', pr.email)
               from public.profiles pr where pr.id = s.seller_id),
    'buyer', (select to_jsonb(sp.*) from public.sale_parties sp
              where sp.sale_id = s.id and sp.party_role = 'PRIMARY_BUYER'),
    'coBuyer', (select to_jsonb(sp.*) from public.sale_parties sp
                where sp.sale_id = s.id and sp.party_role = 'CO_BUYER'),
    'units', coalesce((select jsonb_agg(to_jsonb(su.*) order by su.position)
                       from public.sale_units su where su.sale_id = s.id), '[]'::jsonb),
    'extras', coalesce((select jsonb_agg(to_jsonb(se.*) order by se.position)
                        from public.sale_extras se where se.sale_id = s.id), '[]'::jsonb),
    'cubaRecipient', (select to_jsonb(r.*) from public.sale_cuba_recipients r
                      where r.sale_id = s.id),
    'delivery', (select to_jsonb(d.*) from public.sale_deliveries d where d.sale_id = s.id),
    'documents', coalesce((select jsonb_agg(jsonb_build_object(
                             'subjectType', sd.subject_type,
                             'side', sd.side,
                             'storagePath', sd.storage_path,
                             'mimeType', sd.mime_type,
                             'fileSizeBytes', sd.file_size_bytes))
                          from public.sale_documents sd where sd.sale_id = s.id), '[]'::jsonb),
    'changeHistory', coalesce((select jsonb_agg(jsonb_build_object(
                             'id', h.id,
                             'editGroup', h.edit_group,
                             'changedAt', h.changed_at,
                             'changedByName', (select pr.full_name from public.profiles pr
                                               where pr.id = h.changed_by),
                             'reason', h.reason,
                             'fieldPath', h.field_path,
                             'changeType', h.change_type,
                             'oldValue', h.old_value,
                             'newValue', h.new_value)
                             order by h.changed_at desc, h.field_path)
                          from public.sale_change_history h where h.sale_id = s.id), '[]'::jsonb),
    'statusHistory', coalesce((select jsonb_agg(jsonb_build_object(
                             'id', sh.id,
                             'fromStatus', sh.from_status,
                             'toStatus', sh.to_status,
                             'changedAt', sh.created_at,
                             'changedByName', (select pr.full_name from public.profiles pr
                                               where pr.id = sh.changed_by),
                             'reason', sh.reason)
                             order by sh.created_at asc)
                          from public.sale_status_history sh where sh.sale_id = s.id), '[]'::jsonb),
    'paymentAllocations', coalesce((select jsonb_agg(jsonb_build_object(
                             'id', a.id,
                             'paymentMethodId', a.payment_method_id,
                             'paymentMethodPlanId', a.payment_method_plan_id,
                             'position', a.position,
                             'inputMode', a.input_mode,
                             'grossAmountCents', a.gross_amount_cents,
                             'feeAmountCents', a.fee_amount_cents,
                             'netAmountCents', a.net_amount_cents,
                             'feeBpsSnapshot', a.fee_bps_snapshot,
                             'fixedFeeCentsSnapshot', a.fixed_fee_cents_snapshot,
                             'providerNameSnapshot', a.provider_name_snapshot,
                             'planLabelSnapshot', a.plan_label_snapshot,
                             'feeStrategySnapshot', a.fee_strategy_snapshot,
                             'methodType', (select m.method_type from public.payment_methods m
                                            where m.id = a.payment_method_id),
                             'methodOnlyFlorida', (select m.only_florida from public.payment_methods m
                                                   where m.id = a.payment_method_id),
                             'methodIsActive', (select m.is_active from public.payment_methods m
                                                where m.id = a.payment_method_id),
                             'methodRequiresSignedContract', (select m.requires_signed_contract
                                                   from public.payment_methods m
                                                   where m.id = a.payment_method_id),
                             'settlementStatus', a.settlement_status,
                             'settledAt', a.settled_at,
                             'financingContractId', (select c.id from public.sale_financing_contracts c
                                                     where c.payment_allocation_id = a.id),
                             'reference', a.reference,
                             'notes', a.notes)
                             order by a.position)
                          from public.sale_payment_allocations a where a.sale_id = s.id), '[]'::jsonb),
    'financingContracts', coalesce((select jsonb_agg(jsonb_build_object(
                             'id', c.id,
                             'paymentAllocationId', c.payment_allocation_id,
                             'paymentMethodId', c.payment_method_id,
                             'status', c.status,
                             'grossAmountCents', c.gross_amount_cents,
                             'feeAmountCents', c.fee_amount_cents,
                             'netAmountCents', c.net_amount_cents,
                             'planLabelSnapshot', c.plan_label_snapshot,
                             'planCodeSnapshot', c.plan_code_snapshot,
                             'providerNameSnapshot', c.provider_name_snapshot,
                             'contractStoragePath', c.contract_storage_path,
                             'sentAt', c.sent_at,
                             'sentByName', (select pr.full_name from public.profiles pr where pr.id = c.sent_by),
                             'signedAt', c.signed_at,
                             'signedByName', (select pr.full_name from public.profiles pr where pr.id = c.signed_by),
                             'accreditedAt', c.accredited_at,
                             'accreditedByName', (select pr.full_name from public.profiles pr where pr.id = c.accredited_by))
                             order by c.sent_at)
                          from public.sale_financing_contracts c where c.sale_id = s.id), '[]'::jsonb),
    'financingContractEvents', coalesce((select jsonb_agg(jsonb_build_object(
                             'id', e.id,
                             'contractId', e.contract_id,
                             'fromStatus', e.from_status,
                             'toStatus', e.to_status,
                             'changedAt', e.created_at,
                             'changedByName', (select pr.full_name from public.profiles pr where pr.id = e.changed_by),
                             'note', e.note)
                             order by e.created_at)
                          from public.financing_contract_events e
                          where e.contract_id in (select id from public.sale_financing_contracts where sale_id = s.id)
                          ), '[]'::jsonb),
    -- Cobro: SIEMPRE calculado en vivo (nunca solo la foto guardada), para
    -- que la ficha de la venta nunca muestre un número desactualizado.
    'settlement', (
      select jsonb_build_object(
        'status', s.settlement_status,
        'closingReviewedAt', s.closing_reviewed_at,
        'closingReviewedByName', (select pr.full_name from public.profiles pr where pr.id = s.closing_reviewed_by),
        'amountCollectedCents', coalesce(live.collected_cents, 0),
        'amountOutstandingCents', greatest(0, coalesce(s.sale_total_cents, 0) - coalesce(live.collected_cents, 0)),
        'saleTotalCents', coalesce(s.sale_total_cents, 0),
        'readyForPaid', coalesce(live.all_covered, false)
                         and coalesce(s.sale_total_cents, 0) > 0
                         and coalesce(live.collected_cents, 0) = coalesce(s.sale_total_cents, 0)
      )
      from (
        select
          sum(case
                when m.method_type = 'FINANCING' then
                  case when exists (
                    select 1 from public.sale_financing_contracts c
                    where c.payment_allocation_id = a.id and c.status = 'ACCREDITED'
                  ) then a.net_amount_cents else 0 end
                else
                  case when a.settlement_status = 'SETTLED' then a.net_amount_cents else 0 end
              end) as collected_cents,
          bool_and(
            case
              when m.method_type = 'FINANCING' then exists (
                select 1 from public.sale_financing_contracts c
                where c.payment_allocation_id = a.id and c.status = 'ACCREDITED'
              )
              else a.settlement_status = 'SETTLED'
            end
          ) as all_covered
        from public.sale_payment_allocations a
        join public.payment_methods m on m.id = a.payment_method_id
        where a.sale_id = s.id
      ) live
    )
  )
  from public.sales s
  where s.id = p_sale_id;   -- RLS: solo ventas propias / admin
$$;

-- ===========================================================================
-- 9. seller_sales_list — + filtro y columna de estado de cobro.
-- ===========================================================================
create or replace function public.seller_sales_list(
  p_search           text default null,
  p_start_date       date default null,
  p_end_date         date default null,
  p_status           text default 'ALL',
  p_operation_type   text default 'ALL',
  p_financing_status text default 'ALL',
  p_settlement       text default 'ALL',
  p_limit            int  default 20,
  p_offset           int  default 0
)
returns jsonb
language sql
security invoker
set search_path = public
stable
as $$
  with args as (
    select
      nullif(btrim(coalesce(p_search, '')), '')            as search,
      coalesce(nullif(upper(btrim(p_status)), ''), 'ALL')  as status,
      coalesce(nullif(upper(btrim(p_operation_type)), ''), 'ALL') as operation_type,
      coalesce(nullif(upper(btrim(p_financing_status)), ''), 'ALL') as financing_status,
      coalesce(nullif(upper(btrim(p_settlement)), ''), 'ALL') as settlement,
      greatest(1, least(coalesce(p_limit, 20), 100))       as page_size,
      greatest(0, coalesce(p_offset, 0))                   as row_offset
  ),
  base as (
    select
      s.id, s.sale_number, s.status, s.operation_type, s.sale_date, s.created_at,
      s.sold_at, s.paid_at, s.review_requested_at, s.sale_total_cents,
      s.settlement_status, s.closing_reviewed_at, s.amount_outstanding_cents,
      coalesce(s.sale_date, s.created_at::date) as effective_date
    from public.sales s, args a
    where s.seller_id = auth.uid()
      and (a.status = 'ALL' or s.status = a.status)
      and (a.operation_type = 'ALL' or s.operation_type = a.operation_type)
      and (a.settlement = 'ALL' or coalesce(s.settlement_status, '') = a.settlement)
      and (p_start_date is null or coalesce(s.sale_date, s.created_at::date) >= p_start_date)
      and (p_end_date   is null or coalesce(s.sale_date, s.created_at::date) <= p_end_date)
  ),
  fin as (
    select
      b.id as sale_id,
      count(*) filter (where m.method_type = 'FINANCING')                as providers,
      count(*) filter (where m.method_type = 'FINANCING' and c.id is null) as pending_contract,
      count(*) filter (where c.status = 'SENT')                          as sent,
      count(*) filter (where c.status = 'SIGNED')                        as signed,
      count(*) filter (where c.status = 'ACCREDITED')                    as accredited
    from base b
    left join public.sale_payment_allocations a on a.sale_id = b.id
    left join public.payment_methods m on m.id = a.payment_method_id
    left join public.sale_financing_contracts c on c.payment_allocation_id = a.id
    group by b.id
  ),
  matched as (
    select b.*, coalesce(f.providers, 0) as fin_providers,
           coalesce(f.pending_contract, 0) as fin_pending, coalesce(f.sent, 0) as fin_sent,
           coalesce(f.signed, 0) as fin_signed, coalesce(f.accredited, 0) as fin_accredited
    from base b
    left join fin f on f.sale_id = b.id, args a
    where (
      a.search is null
      or b.sale_number ilike '%' || a.search || '%'
      or exists (
           select 1 from public.sale_parties sp
           where sp.sale_id = b.id
             and sp.party_role = 'PRIMARY_BUYER'
             and (
               coalesce(sp.first_name, '') ilike '%' || a.search || '%'
               or coalesce(sp.last_name, '') ilike '%' || a.search || '%'
               or btrim(coalesce(sp.first_name, '') || ' ' || coalesce(sp.last_name, ''))
                    ilike '%' || a.search || '%'
             )
         )
      or exists (
           select 1 from public.sale_units su
           where su.sale_id = b.id
             and (
               coalesce(su.product_name_snapshot, '') ilike '%' || a.search || '%'
               or coalesce(su.tracking_code, '') ilike '%' || a.search || '%'
             )
         )
      or exists (
           select 1 from public.sale_payment_allocations al
           where al.sale_id = b.id
             and coalesce(al.provider_name_snapshot, '') ilike '%' || a.search || '%'
         )
    )
    and (
      a.financing_status = 'ALL'
      or (a.financing_status = 'NONE' and coalesce(f.providers, 0) = 0)
      or (a.financing_status = 'PENDING_CONTRACT' and coalesce(f.pending_contract, 0) > 0)
      or (a.financing_status = 'SENT' and coalesce(f.sent, 0) > 0)
      or (a.financing_status = 'SIGNED' and coalesce(f.signed, 0) > 0)
      or (a.financing_status = 'ACCREDITED' and coalesce(f.accredited, 0) > 0)
    )
  ),
  page_rows as (
    select m.*
    from matched m, args a
    order by m.effective_date desc, m.created_at desc
    limit  (select page_size from args)
    offset (select row_offset from args)
  ),
  items as (
    select
      m.effective_date,
      m.created_at,
      jsonb_build_object(
        'saleId',          m.id,
        'saleNumber',      m.sale_number,
        'status',          m.status,
        'operationType',   m.operation_type,
        'saleDate',        to_char(m.effective_date, 'YYYY-MM-DD'),
        'hasExplicitDate', (m.sale_date is not null),
        'soldAt',          m.sold_at,
        'paidAt',          m.paid_at,
        'reviewRequestedAt', m.review_requested_at,
        'settlementStatus', m.settlement_status,
        'closingReviewedAt', m.closing_reviewed_at,
        'amountOutstandingCents', m.amount_outstanding_cents,
        'buyerName', (
          select nullif(btrim(coalesce(sp.first_name, '') || ' ' || coalesce(sp.last_name, '')), '')
          from public.sale_parties sp
          where sp.sale_id = m.id and sp.party_role = 'PRIMARY_BUYER'
        ),
        'unitCount', (select count(*) from public.sale_units su where su.sale_id = m.id),
        'units', coalesce((
          select jsonb_agg(
                   jsonb_build_object(
                     'productName',  su.product_name_snapshot,
                     'variant',      su.variant_snapshot,
                     'trackingCode', su.tracking_code)
                   order by su.position)
          from (
            select su2.*
            from public.sale_units su2
            where su2.sale_id = m.id
            order by su2.position
            limit 6
          ) su
        ), '[]'::jsonb),
        'saleTotalCents', coalesce(
          m.sale_total_cents,
          (select coalesce(sum(su.agreed_price_cents), 0)
             from public.sale_units su where su.sale_id = m.id)
          + (select coalesce(sum(greatest(1, se.quantity) * greatest(0, se.unit_price_cents)), 0)
             from public.sale_extras se where se.sale_id = m.id)
        ),
        'financing', jsonb_build_object(
          'providers', m.fin_providers,
          'pendingContract', m.fin_pending,
          'sent', m.fin_sent,
          'signed', m.fin_signed,
          'accredited', m.fin_accredited
        )
      ) as item
    from page_rows m
  )
  select jsonb_build_object(
    'items', coalesce(
      (select jsonb_agg(item order by effective_date desc, created_at desc) from items),
      '[]'::jsonb),
    'page', (
      (select row_offset from args) / (select page_size from args)
    )::int + 1,
    'pageSize', (select page_size from args),
    'totalCount', (select count(*) from matched),
    'summary', jsonb_build_object(
      'operations',   (select count(*) from matched),
      'draftCount',   (select count(*) from matched where status = 'DRAFT'),
      'pendingCount', (select count(*) from matched where status = 'PENDING'),
      'soldCount',    (select count(*) from matched where status = 'SOLD'),
      'paidCount',    (select count(*) from matched where status = 'PAID'),
      'volumeCents',
        coalesce((select sum(sale_total_cents) from matched where status in ('SOLD', 'PAID')), 0),
      'unitsSold', (
        select count(*)
        from public.sale_units su
        join matched mm on mm.id = su.sale_id and mm.status in ('SOLD', 'PAID')
      )
    )
  );
$$;

revoke all on function public.seller_sales_list(text, date, date, text, text, text, text, int, int)
  from public, anon;
grant execute on function public.seller_sales_list(text, date, date, text, text, text, text, int, int)
  to authenticated;

drop function if exists public.seller_sales_list(text, date, date, text, text, text, int, int);
