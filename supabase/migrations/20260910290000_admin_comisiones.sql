-- ===========================================================================
-- ADMIN · COMISIONES — motor de comisión de vendedor + gestión admin +
-- visibilidad del vendedor.
--
-- Nada de esto existía: ni columnas de configuración de comisión, ni tabla
-- de registro, ni auditoría. `legacy_commission_cents` (solo referencia,
-- confirmado sin ningún uso en cálculo) se deja intacto.
--
-- Fórmula (idéntica en todo el motor, nunca coma flotante):
--   difference          = sale_price_cents - reference_price_cents
--   seller_share        = trunc(difference / 2)   -- división entera de
--                          Postgres para bigint YA trunca hacia cero, tanto
--                          para positivos como negativos (101/2=50,
--                          -101/2=-50) — verificado con pruebas reales.
--   final_commission    = greatest(0, base_commission_cents + seller_share)
--
-- La comisión NUNCA es negativa; nunca se traslada un déficit a otra venta.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Configuración de comisión — STOCKED en la unidad física; ON_DEMAND en
--    el producto (ninguna variante tiene hoy ningún campo de precio en
--    ningún lugar del esquema — el fallback a nivel de variante
--    introduciría una granularidad de precio inexistente en el resto del
--    modelo de datos; se documenta esta decisión aquí).
-- ---------------------------------------------------------------------------
alter table public.inventory_units
  add column if not exists reference_price_cents bigint,
  add column if not exists base_commission_cents bigint;
comment on column public.inventory_units.reference_price_cents is
  'Precio de referencia para el cálculo de comisión de ESTA unidad física. Configuración ACTUAL — las ventas ya SOLD guardan su propio snapshot en sale_commissions, nunca leen este valor en vivo.';
comment on column public.inventory_units.base_commission_cents is
  'Comisión base del vendedor para ESTA unidad física, antes del ajuste 50% por diferencia de precio.';

alter table public.products
  add column if not exists default_reference_price_cents bigint,
  add column if not exists default_base_commission_cents bigint;
comment on column public.products.default_reference_price_cents is
  'Fallback de comisión para ventas BAJO PEDIDO (sin VIN) de este producto. Nunca se infiere de base_price_cents/cuba_total_cents — es una configuración de comisión dedicada, no un precio de catálogo.';
comment on column public.products.default_base_commission_cents is
  'Comisión base por defecto para ventas bajo pedido de este producto.';

-- Extiende (no duplica) la auditoría ya existente de cada dominio con el
-- único evento nuevo que le falta.
alter table public.inventory_unit_events drop constraint inventory_unit_events_event_type_check;
alter table public.inventory_unit_events add constraint inventory_unit_events_event_type_check
  check (event_type in (
    'UNIT_CREATED', 'UNIT_IMPORTED', 'VIN_UPDATED',
    'UNIT_RESERVED', 'RESERVATION_RELEASED', 'UNIT_SOLD',
    'COMMISSION_CONFIG_UPDATED'
  ));

alter table public.product_catalog_events drop constraint product_catalog_events_event_type_check;
alter table public.product_catalog_events add constraint product_catalog_events_event_type_check
  check (event_type in (
    'PRODUCT_CREATED', 'PRODUCT_UPDATED', 'PRODUCT_ACTIVATED', 'PRODUCT_DEACTIVATED',
    'PRODUCT_DUPLICATED', 'PRICE_CHANGED',
    'VARIANT_CREATED', 'VARIANT_UPDATED', 'VARIANT_ACTIVATED', 'VARIANT_DEACTIVATED',
    'IMAGE_ADDED', 'IMAGE_REMOVED', 'PRIMARY_IMAGE_CHANGED',
    'COMMISSION_DEFAULTS_UPDATED'
  ));

-- ---------------------------------------------------------------------------
-- 2. sale_commissions — el registro ES el snapshot (calculado una única vez
--    al pasar a SOLD; nunca recalculado desde config viva salvo el único
--    camino explícito y auditado: una edición de precio ya aprobada). No se
--    duplican estos mismos campos también en `sale_units` — sería el mismo
--    dato en dos lugares sin ninguna ganancia real.
-- ---------------------------------------------------------------------------
create table public.sale_commissions (
  id                             uuid primary key default gen_random_uuid(),
  sale_id                        uuid not null references public.sales (id) on delete cascade,
  sale_unit_id                   uuid not null references public.sale_units (id) on delete cascade,
  seller_id                      uuid not null references public.profiles (id) on delete restrict,
  reference_price_cents          bigint not null,
  sale_price_cents               bigint not null,
  base_commission_cents          bigint not null,
  price_difference_cents         bigint not null,
  seller_difference_share_cents  bigint not null,
  final_commission_cents         bigint not null,
  status                         text not null default 'PENDING'
                                   check (status in ('PENDING', 'ELIGIBLE', 'VOID')),
  calculated_at                  timestamptz not null default now(),
  eligible_at                    timestamptz,
  source_type                    text not null check (source_type in ('INVENTORY_UNIT', 'PRODUCT')),
  source_id                      uuid,
  created_at                     timestamptz not null default now(),
  updated_at                     timestamptz not null default now(),
  unique (sale_unit_id)
);
comment on table public.sale_commissions is
  'Una fila por sale_unit. Calculada UNA vez al pasar la venta a SOLD (ver mark_sale_sold) — nunca recalculada dinámicamente desde config viva. status VOID se deja disponible para el futuro; ningún camino de esta fase lo produce.';
create index sale_commissions_sale_idx on public.sale_commissions (sale_id);
create index sale_commissions_seller_idx on public.sale_commissions (seller_id, status);
create index sale_commissions_status_idx on public.sale_commissions (status);
create trigger sale_commissions_set_updated_at
  before update on public.sale_commissions
  for each row execute function public.set_updated_at();

alter table public.sale_commissions enable row level security;
grant select on public.sale_commissions to authenticated;
create policy sale_commissions_select on public.sale_commissions
  for select to authenticated
  using (seller_id = auth.uid() or public.is_admin());
-- Sin política de escritura: toda mutación pasa por RPC SECURITY DEFINER.

-- ---------------------------------------------------------------------------
-- 3. commission_events — auditoría enfocada e inmutable.
-- ---------------------------------------------------------------------------
create table public.commission_events (
  id             uuid primary key default gen_random_uuid(),
  commission_id  uuid not null references public.sale_commissions (id) on delete cascade,
  sale_id        uuid not null references public.sales (id) on delete cascade,
  sale_unit_id   uuid not null references public.sale_units (id) on delete cascade,
  event_type     text not null check (event_type in (
                   'COMMISSION_CALCULATED', 'COMMISSION_RECALCULATED',
                   'COMMISSION_ELIGIBLE', 'COMMISSION_ADJUSTED_BY_APPROVED_SALE_EDIT'
                 )),
  actor_id       uuid references public.profiles (id) on delete set null,
  before         jsonb,
  after          jsonb,
  reason         text,
  created_at     timestamptz not null default now()
);
create index commission_events_commission_idx on public.commission_events (commission_id, created_at desc);

alter table public.commission_events enable row level security;
grant select on public.commission_events to authenticated;
create policy commission_events_select_admin on public.commission_events
  for select to authenticated
  using (public.is_admin());

-- ===========================================================================
-- 4. RPCs de configuración — ADMIN-only, auditadas.
-- ===========================================================================
create or replace function public.admin_update_inventory_commission_config(
  p_unit_id uuid, p_reference_price_cents bigint, p_base_commission_cents bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_old public.inventory_units;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;
  if coalesce(p_reference_price_cents, 0) < 0 or coalesce(p_base_commission_cents, 0) < 0 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  select * into v_old from public.inventory_units where id = p_unit_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'UNIT_NOT_FOUND');
  end if;

  update public.inventory_units set
    reference_price_cents = p_reference_price_cents,
    base_commission_cents = p_base_commission_cents
  where id = p_unit_id;

  insert into public.inventory_unit_events (inventory_unit_id, event_type, actor_id, changes)
  values (p_unit_id, 'COMMISSION_CONFIG_UPDATED', v_uid, jsonb_build_object(
    'from', jsonb_build_object('referencePriceCents', v_old.reference_price_cents, 'baseCommissionCents', v_old.base_commission_cents),
    'to', jsonb_build_object('referencePriceCents', p_reference_price_cents, 'baseCommissionCents', p_base_commission_cents)));

  return jsonb_build_object('ok', true, 'unitId', p_unit_id);
end;
$$;
revoke all on function public.admin_update_inventory_commission_config(uuid, bigint, bigint) from public, anon;
grant execute on function public.admin_update_inventory_commission_config(uuid, bigint, bigint) to authenticated;

create or replace function public.admin_update_product_commission_defaults(
  p_product_id uuid, p_default_reference_price_cents bigint, p_default_base_commission_cents bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_old public.products;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;
  if coalesce(p_default_reference_price_cents, 0) < 0 or coalesce(p_default_base_commission_cents, 0) < 0 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  select * into v_old from public.products where id = p_product_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'PRODUCT_NOT_FOUND');
  end if;

  update public.products set
    default_reference_price_cents = p_default_reference_price_cents,
    default_base_commission_cents = p_default_base_commission_cents
  where id = p_product_id;

  insert into public.product_catalog_events (product_id, event_type, actor_id, changes)
  values (p_product_id, 'COMMISSION_DEFAULTS_UPDATED', v_uid, jsonb_build_object(
    'from', jsonb_build_object('defaultReferencePriceCents', v_old.default_reference_price_cents, 'defaultBaseCommissionCents', v_old.default_base_commission_cents),
    'to', jsonb_build_object('defaultReferencePriceCents', p_default_reference_price_cents, 'defaultBaseCommissionCents', p_default_base_commission_cents)));

  return jsonb_build_object('ok', true, 'productId', p_product_id);
end;
$$;
revoke all on function public.admin_update_product_commission_defaults(uuid, bigint, bigint) from public, anon;
grant execute on function public.admin_update_product_commission_defaults(uuid, bigint, bigint) to authenticated;

-- ===========================================================================
-- 5. mark_sale_sold — ÚNICO cambio real: valida configuración de comisión
--    de CADA unidad ANTES de mutar nada (si falta, bloquea con
--    COMMISSION_CONFIG_MISSING, cero mutación parcial); tras el resto de la
--    lógica ya vigente, calcula y graba la comisión de cada unidad. Todo lo
--    demás de esta función es EXACTAMENTE igual a la versión vigente
--    (20260910270000_admin_inventario.sql).
-- ===========================================================================
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
  -- comisión
  v_cu                record;
  v_commission_missing text[] := array[]::text[];
  v_ref_price bigint;
  v_base_comm bigint;
  v_source_type text;
  v_source_id uuid;
  v_diff bigint;
  v_share bigint;
  v_final bigint;
  v_commission_id uuid;
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

  -- Contratos de financiación OBLIGATORIOS: SNAPSHOT de la asignación
  -- (`requires_signed_contract_snapshot`, fijado al configurar el pago),
  -- NUNCA la configuración actual de `payment_methods`. Deben estar
  -- FIRMADOS o ACREDITADOS, verificado contra los registros reales de
  -- `sale_financing_contracts`.
  for v_req in
    select a.provider_name_snapshot as provider_name, c.status as contract_status
    from public.sale_payment_allocations a
    left join public.sale_financing_contracts c on c.payment_allocation_id = a.id
    where a.sale_id = p_sale_id and a.requires_signed_contract_snapshot
  loop
    if v_req.contract_status is null or v_req.contract_status not in ('SIGNED', 'ACCREDITED') then
      v_unsigned := array_append(v_unsigned, v_req.provider_name);
    end if;
  end loop;

  if array_length(v_unsigned, 1) is not null then
    return jsonb_build_object('ok', false, 'code', 'CONTRACT_UNSIGNED', 'providers', to_jsonb(v_unsigned));
  end if;

  -- Comisión: cada unidad debe tener configuración RESOLUBLE antes de mutar
  -- nada. STOCKED (con VIN) exige la config de la unidad física; ON_DEMAND
  -- exige los valores por defecto del producto. Nunca se inventa $0.
  for v_cu in
    select
      su.id as sale_unit_id, su.inventory_unit_id,
      iu.reference_price_cents as iu_ref, iu.base_commission_cents as iu_base,
      p.default_reference_price_cents as p_ref, p.default_base_commission_cents as p_base
    from public.sale_units su
    join public.products p on p.id = su.product_id
    left join public.inventory_units iu on iu.id = su.inventory_unit_id
    where su.sale_id = p_sale_id
  loop
    if v_cu.inventory_unit_id is not null then
      if v_cu.iu_ref is null or v_cu.iu_base is null then
        v_commission_missing := array_append(v_commission_missing, v_cu.sale_unit_id::text);
      end if;
    else
      if v_cu.p_ref is null or v_cu.p_base is null then
        v_commission_missing := array_append(v_commission_missing, v_cu.sale_unit_id::text);
      end if;
    end if;
  end loop;
  if array_length(v_commission_missing, 1) is not null then
    return jsonb_build_object('ok', false, 'code', 'COMMISSION_CONFIG_MISSING', 'saleUnitIds', to_jsonb(v_commission_missing));
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

  -- Inventario: unidades RESERVED asociadas a esta venta pasan a SOLD.
  -- Solo actúa sobre lo que un admin YA reservó explícitamente — nunca
  -- inventa ni asigna un VIN nuevo aquí.
  for v_unit in
    select iu.id as inventory_unit_id, su.id as sale_unit_id
    from public.sale_units su
    join public.inventory_units iu on iu.id = su.inventory_unit_id
    where su.sale_id = p_sale_id and iu.status = 'RESERVED'
  loop
    update public.inventory_units set status = 'SOLD' where id = v_unit.inventory_unit_id;
    insert into public.inventory_unit_events (
      inventory_unit_id, event_type, actor_id, from_status, to_status, sale_id, sale_unit_id)
    values (v_unit.inventory_unit_id, 'UNIT_SOLD', v_uid, 'RESERVED', 'SOLD', p_sale_id, v_unit.sale_unit_id);
  end loop;

  -- Comisión: calcula y graba UNA vez por unidad (config ya validada arriba).
  for v_cu in
    select
      su.id as sale_unit_id, su.inventory_unit_id, su.product_id, su.agreed_price_cents,
      iu.reference_price_cents as iu_ref, iu.base_commission_cents as iu_base,
      p.default_reference_price_cents as p_ref, p.default_base_commission_cents as p_base
    from public.sale_units su
    join public.products p on p.id = su.product_id
    left join public.inventory_units iu on iu.id = su.inventory_unit_id
    where su.sale_id = p_sale_id
  loop
    if v_cu.inventory_unit_id is not null then
      v_ref_price := v_cu.iu_ref;
      v_base_comm := v_cu.iu_base;
      v_source_type := 'INVENTORY_UNIT';
      v_source_id := v_cu.inventory_unit_id;
    else
      v_ref_price := v_cu.p_ref;
      v_base_comm := v_cu.p_base;
      v_source_type := 'PRODUCT';
      v_source_id := v_cu.product_id;
    end if;

    v_diff := v_cu.agreed_price_cents - v_ref_price;
    v_share := v_diff / 2;  -- división entera de Postgres: trunca hacia cero.
    v_final := greatest(0, v_base_comm + v_share);

    insert into public.sale_commissions (
      sale_id, sale_unit_id, seller_id,
      reference_price_cents, sale_price_cents, base_commission_cents,
      price_difference_cents, seller_difference_share_cents, final_commission_cents,
      status, calculated_at, source_type, source_id)
    values (
      p_sale_id, v_cu.sale_unit_id, v_sale.seller_id,
      v_ref_price, v_cu.agreed_price_cents, v_base_comm,
      v_diff, v_share, v_final,
      'PENDING', now(), v_source_type, v_source_id)
    returning id into v_commission_id;

    insert into public.commission_events (commission_id, sale_id, sale_unit_id, event_type, actor_id, after)
    values (v_commission_id, p_sale_id, v_cu.sale_unit_id, 'COMMISSION_CALCULATED', v_uid,
      jsonb_build_object(
        'referencePriceCents', v_ref_price, 'baseCommissionCents', v_base_comm,
        'salePriceCents', v_cu.agreed_price_cents, 'differenceCents', v_diff,
        'sellerShareCents', v_share, 'finalCommissionCents', v_final, 'sourceType', v_source_type));
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

-- ===========================================================================
-- 6. admin_mark_sale_paid — ÚNICO cambio: tras SOLD→PAID, todas las
--    comisiones PENDING de esta venta pasan a ELIGIBLE con
--    `eligible_at = paid_at` (mismo timestamp autoritativo). Una venta
--    SOLD anterior a este motor (0 filas de comisión) NO se bloquea —
--    simplemente no hay nada que transicionar (ver informe: backfill no es
--    posible para datos históricos). Todo lo demás es idéntico a la
--    versión vigente (20260910210000_seller_sold_admin_settlement.sql).
-- ===========================================================================
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
  v_paid_at   timestamptz := now();
  v_comm      record;
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
    paid_at                   = v_paid_at,
    paid_by                   = v_uid,
    settlement_status         = 'PAID',
    amount_collected_cents    = v_collected,
    amount_outstanding_cents  = 0
  where id = p_sale_id;

  insert into public.sale_status_history (sale_id, from_status, to_status, changed_by, reason)
  values (p_sale_id, 'SOLD', 'PAID', v_uid, 'Confirmado por administrador');

  for v_comm in
    select id from public.sale_commissions
    where sale_id = p_sale_id and status = 'PENDING'
    for update
  loop
    update public.sale_commissions set status = 'ELIGIBLE', eligible_at = v_paid_at where id = v_comm.id;
    insert into public.commission_events (commission_id, sale_id, sale_unit_id, event_type, actor_id, before, after)
    select v_comm.id, sc.sale_id, sc.sale_unit_id, 'COMMISSION_ELIGIBLE', v_uid,
      jsonb_build_object('status', 'PENDING'), jsonb_build_object('status', 'ELIGIBLE', 'eligibleAt', v_paid_at)
    from public.sale_commissions sc where sc.id = v_comm.id;
  end loop;

  return jsonb_build_object('ok', true, 'saleId', p_sale_id, 'status', 'PAID', 'collectedCents', v_collected);
end;
$$;
revoke all on function public.admin_mark_sale_paid(uuid) from public, anon;
grant execute on function public.admin_mark_sale_paid(uuid) to authenticated;

-- ===========================================================================
-- 7. approve_sale_edit_request — ÚNICO cambio: si la venta está SOLD y el
--    cambio aprobado tocó `agreed_price_cents` de una unidad con comisión
--    ya calculada, recalcula EXCLUSIVAMENTE el precio de venta, preservando
--    el reference_price/base_commission ORIGINALMENTE snapshoteados (nunca
--    la config viva). Todo lo demás de esta función es idéntico a la
--    versión vigente (20260910280100_admin_aprobaciones_fixes.sql).
-- ===========================================================================
create or replace function public.approve_sale_edit_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_req public.sale_edit_requests;
  v_sale public.sales;
  v_snapshot jsonb;
  v_flat jsonb;
  v_payload jsonb;
  v_entry jsonb;
  v_path text;
  v_current text;
  v_id_part text;
  v_field text;
  v_id uuid;
  v_units jsonb;
  v_extras jsonb;
  v_new_units jsonb := '[]'::jsonb;
  v_new_extras jsonb := '[]'::jsonb;
  v_u jsonb;
  v_result jsonb;
  -- comisión
  v_touched_units uuid[] := array[]::uuid[];
  v_comm public.sale_commissions;
  v_new_price bigint;
  v_new_diff bigint;
  v_new_share bigint;
  v_new_final bigint;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  select * into v_req from public.sale_edit_requests where id = p_request_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'REQUEST_NOT_FOUND');
  end if;
  if v_req.status <> 'PENDING' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATUS');
  end if;

  select * into v_sale from public.sales where id = v_req.sale_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'SALE_NOT_FOUND');
  end if;
  if v_sale.status not in ('PENDING', 'SOLD') then
    return jsonb_build_object('ok', false, 'code', 'SALE_STATUS_CHANGED');
  end if;

  v_snapshot := public.sale_edit_snapshot(v_req.sale_id);
  v_payload := v_snapshot->'payload';
  v_flat := v_snapshot->'flat';

  for v_entry in select * from jsonb_array_elements(v_req.requested_changes) loop
    v_path := v_entry->>'path';
    v_current := v_flat->>v_path;
    if coalesce(v_entry->>'oldValue', '') is distinct from coalesce(v_current, '') then
      return jsonb_build_object('ok', false, 'code', 'REQUEST_CONFLICT',
        'path', v_path, 'currentValue', v_current, 'declaredOldValue', v_entry->>'oldValue');
    end if;
  end loop;

  for v_entry in select * from jsonb_array_elements(v_req.requested_changes) loop
    v_path := v_entry->>'path';
    if v_path = 'buyer.first_name' then v_payload := jsonb_set(v_payload, '{buyer,firstName}', to_jsonb(v_entry->>'newValue'));
    elsif v_path = 'buyer.last_name' then v_payload := jsonb_set(v_payload, '{buyer,lastName}', to_jsonb(v_entry->>'newValue'));
    elsif v_path = 'buyer.phone' then v_payload := jsonb_set(v_payload, '{buyer,phone}', to_jsonb(v_entry->>'newValue'));
    elsif v_path = 'buyer.email' then v_payload := jsonb_set(v_payload, '{buyer,email}', to_jsonb(coalesce(v_entry->>'newValue', '')));
    elsif v_path = 'buyer.address_line1' then v_payload := jsonb_set(v_payload, '{buyer,addressLine1}', to_jsonb(coalesce(v_entry->>'newValue', '')));
    elsif v_path = 'buyer.address_line2' then v_payload := jsonb_set(v_payload, '{buyer,addressLine2}', to_jsonb(coalesce(v_entry->>'newValue', '')));
    elsif v_path = 'buyer.city' then v_payload := jsonb_set(v_payload, '{buyer,city}', to_jsonb(coalesce(v_entry->>'newValue', '')));
    elsif v_path = 'buyer.state' then v_payload := jsonb_set(v_payload, '{buyer,state}', to_jsonb(coalesce(v_entry->>'newValue', '')));
    elsif v_path = 'buyer.postal_code' then v_payload := jsonb_set(v_payload, '{buyer,postalCode}', to_jsonb(coalesce(v_entry->>'newValue', '')));
    elsif v_path = 'buyer.document_number' then v_payload := jsonb_set(v_payload, '{buyer,documentNumber}', to_jsonb(v_entry->>'newValue'));
    elsif v_path = 'recipient.full_name' then v_payload := jsonb_set(v_payload, '{cubaRecipient,fullName}', to_jsonb(v_entry->>'newValue'));
    elsif v_path = 'recipient.identity_number' then v_payload := jsonb_set(v_payload, '{cubaRecipient,identityNumber}', to_jsonb(v_entry->>'newValue'));
    elsif v_path = 'recipient.delivery_address' then v_payload := jsonb_set(v_payload, '{cubaRecipient,deliveryAddress}', to_jsonb(v_entry->>'newValue'));
    elsif v_path = 'recipient.municipality' then v_payload := jsonb_set(v_payload, '{cubaRecipient,municipality}', to_jsonb(coalesce(v_entry->>'newValue', '')));
    elsif v_path = 'recipient.province' then v_payload := jsonb_set(v_payload, '{cubaRecipient,province}', to_jsonb(v_entry->>'newValue'));
    elsif v_path = 'recipient.primary_phone' then v_payload := jsonb_set(v_payload, '{cubaRecipient,phonePrimary}', to_jsonb(v_entry->>'newValue'));
    elsif v_path = 'recipient.secondary_phone' then v_payload := jsonb_set(v_payload, '{cubaRecipient,phoneSecondary}', to_jsonb(coalesce(v_entry->>'newValue', '')));
    elsif v_path = 'delivery.method' then v_payload := jsonb_set(v_payload, '{delivery,method}', to_jsonb(v_entry->>'newValue'));
    elsif v_path = 'delivery.pickup_reference' then v_payload := jsonb_set(v_payload, '{delivery,reference}', to_jsonb(coalesce(v_entry->>'newValue', '')));
    elsif v_path = 'internal_notes' then v_payload := jsonb_set(v_payload, '{internalNotes}', to_jsonb(coalesce(v_entry->>'newValue', '')));
    end if;
  end loop;

  v_units := v_payload->'units';
  for v_u in select * from jsonb_array_elements(v_units) loop
    v_id_part := v_u->>'id';
    for v_entry in select * from jsonb_array_elements(v_req.requested_changes) loop
      v_path := v_entry->>'path';
      if v_path = 'units.' || v_id_part || '.variant_id' then
        v_u := jsonb_set(v_u, '{variantId}', to_jsonb(nullif(v_entry->>'newValue', '')));
      elsif v_path = 'units.' || v_id_part || '.agreed_price_cents' then
        v_u := jsonb_set(v_u, '{agreedPriceCents}', to_jsonb((v_entry->>'newValue')::bigint));
        v_touched_units := array_append(v_touched_units, v_id_part::uuid);
      end if;
    end loop;
    v_new_units := v_new_units || jsonb_build_array(v_u);
  end loop;
  v_payload := jsonb_set(v_payload, '{units}', v_new_units);

  v_extras := v_payload->'extras';
  for v_u in select * from jsonb_array_elements(v_extras) loop
    v_id_part := v_u->>'id';
    for v_entry in select * from jsonb_array_elements(v_req.requested_changes) loop
      v_path := v_entry->>'path';
      if v_path = 'extras.' || v_id_part || '.description' then
        v_u := jsonb_set(v_u, '{description}', to_jsonb(nullif(v_entry->>'newValue', '')));
      elsif v_path = 'extras.' || v_id_part || '.quantity' then
        v_u := jsonb_set(v_u, '{quantity}', to_jsonb((v_entry->>'newValue')::int));
      elsif v_path = 'extras.' || v_id_part || '.unit_price_cents' then
        v_u := jsonb_set(v_u, '{unitAmountCents}', to_jsonb((v_entry->>'newValue')::bigint));
      end if;
    end loop;
    v_new_extras := v_new_extras || jsonb_build_array(v_u);
  end loop;
  v_payload := jsonb_set(v_payload, '{extras}', v_new_extras);

  perform set_config('motods.acting_as_seller', v_sale.seller_id::text, true);
  perform set_config('motods.edit_request_id', p_request_id::text, true);
  perform set_config('motods.edit_requested_by', v_req.requested_by::text, true);

  v_result := public.update_confirmed_cuba_sale(v_req.sale_id, v_payload, v_req.reason);

  if coalesce((v_result->>'ok')::boolean, false) then
    update public.sale_edit_requests set
      status = 'APPROVED', reviewed_at = now(), reviewed_by = v_uid
    where id = p_request_id;

    -- Comisión: solo si la venta YA está SOLD (en PENDING todavía no existe
    -- comisión — nada que hacer) y el precio de alguna unidad cambió.
    -- Recalcula ÚNICAMENTE el precio de venta; reference_price_cents y
    -- base_commission_cents quedan EXACTAMENTE como se snapshotearon al
    -- pasar a SOLD — nunca se relee config viva.
    if v_sale.status = 'SOLD' and array_length(v_touched_units, 1) is not null then
      foreach v_id in array v_touched_units loop
        select * into v_comm from public.sale_commissions where sale_unit_id = v_id for update;
        if found then
          select agreed_price_cents into v_new_price from public.sale_units where id = v_id;
          v_new_diff := v_new_price - v_comm.reference_price_cents;
          v_new_share := v_new_diff / 2;
          v_new_final := greatest(0, v_comm.base_commission_cents + v_new_share);

          update public.sale_commissions set
            sale_price_cents = v_new_price,
            price_difference_cents = v_new_diff,
            seller_difference_share_cents = v_new_share,
            final_commission_cents = v_new_final
          where id = v_comm.id;

          insert into public.commission_events (commission_id, sale_id, sale_unit_id, event_type, actor_id, before, after, reason)
          values (v_comm.id, v_comm.sale_id, v_comm.sale_unit_id, 'COMMISSION_ADJUSTED_BY_APPROVED_SALE_EDIT', v_uid,
            jsonb_build_object('salePriceCents', v_comm.sale_price_cents, 'differenceCents', v_comm.price_difference_cents,
              'sellerShareCents', v_comm.seller_difference_share_cents, 'finalCommissionCents', v_comm.final_commission_cents),
            jsonb_build_object('salePriceCents', v_new_price, 'differenceCents', v_new_diff,
              'sellerShareCents', v_new_share, 'finalCommissionCents', v_new_final),
            'Edición de venta aprobada (solicitud ' || p_request_id::text || ')');
        end if;
      end loop;
    end if;

    return jsonb_build_object('ok', true, 'requestId', p_request_id, 'saleId', v_req.sale_id,
      'changeCount', v_result->'changeCount');
  end if;

  return jsonb_build_object('ok', false, 'code', 'APPLY_FAILED', 'detail', v_result);
end;
$$;
revoke all on function public.approve_sale_edit_request(uuid) from public, anon;
grant execute on function public.approve_sale_edit_request(uuid) to authenticated;

-- ===========================================================================
-- 8. Lectura — ADMIN (KPIs, listado) y compartida seller-o-admin (resumen
--    por venta, lista propia del vendedor).
-- ===========================================================================
create or replace function public.admin_commission_kpis()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  return jsonb_build_object(
    'ok', true,
    'pendingCount', (select count(*) from public.sale_commissions where status = 'PENDING'),
    'eligibleCount', (select count(*) from public.sale_commissions where status = 'ELIGIBLE'),
    'pendingAmountCents', (select coalesce(sum(final_commission_cents), 0) from public.sale_commissions where status = 'PENDING'),
    'eligibleAmountCents', (select coalesce(sum(final_commission_cents), 0) from public.sale_commissions where status = 'ELIGIBLE'),
    'salesWithCommissionCount', (select count(distinct sale_id) from public.sale_commissions),
    'missingConfigCount', (
      (select count(*) from public.inventory_units
        where status in ('AVAILABLE', 'RESERVED')
          and (reference_price_cents is null or base_commission_cents is null))
      +
      (select count(*) from public.products
        where coalesce(stock_mode, '') = 'on_demand'
          and (default_reference_price_cents is null or default_base_commission_cents is null))
    )
  );
end;
$$;
revoke all on function public.admin_commission_kpis() from public, anon;
grant execute on function public.admin_commission_kpis() to authenticated;

create or replace function public.admin_commission_list(
  p_search text default null, p_status text default 'ALL', p_seller_id uuid default null,
  p_product_id uuid default null, p_start_date date default null, p_end_date date default null,
  p_limit int default 30, p_offset int default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_status text := coalesce(nullif(upper(btrim(p_status)), ''), 'ALL');
  v_limit int := greatest(1, least(coalesce(p_limit, 30), 100));
  v_offset int := greatest(0, coalesce(p_offset, 0));
  v_total int;
  v_result jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  with base as (
    select sc.*, s.sale_number, s.sold_at, su.product_name_snapshot, su.variant_snapshot, su.tracking_code,
      pr.full_name as seller_name
    from public.sale_commissions sc
    join public.sales s on s.id = sc.sale_id
    join public.sale_units su on su.id = sc.sale_unit_id
    join public.profiles pr on pr.id = sc.seller_id
    where (v_status = 'ALL' or sc.status = v_status)
      and (p_seller_id is null or sc.seller_id = p_seller_id)
      and (p_product_id is null or su.product_id = p_product_id)
      and (p_start_date is null or s.sold_at::date >= p_start_date)
      and (p_end_date is null or s.sold_at::date <= p_end_date)
      and (
        v_search is null
        or s.sale_number ilike '%' || v_search || '%'
        or pr.full_name ilike '%' || v_search || '%'
        or su.product_name_snapshot ilike '%' || v_search || '%'
        or su.tracking_code ilike '%' || v_search || '%'
      )
  )
  select count(*) into v_total from base;

  with base as (
    select sc.*, s.sale_number, s.sold_at, su.product_name_snapshot, su.variant_snapshot, su.tracking_code,
      pr.full_name as seller_name
    from public.sale_commissions sc
    join public.sales s on s.id = sc.sale_id
    join public.sale_units su on su.id = sc.sale_unit_id
    join public.profiles pr on pr.id = sc.seller_id
    where (v_status = 'ALL' or sc.status = v_status)
      and (p_seller_id is null or sc.seller_id = p_seller_id)
      and (p_product_id is null or su.product_id = p_product_id)
      and (p_start_date is null or s.sold_at::date >= p_start_date)
      and (p_end_date is null or s.sold_at::date <= p_end_date)
      and (
        v_search is null
        or s.sale_number ilike '%' || v_search || '%'
        or pr.full_name ilike '%' || v_search || '%'
        or su.product_name_snapshot ilike '%' || v_search || '%'
        or su.tracking_code ilike '%' || v_search || '%'
      )
    order by sc.calculated_at desc
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'ok', true, 'total', v_total,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'commissionId', b.id, 'saleId', b.sale_id, 'saleNumber', b.sale_number,
        'sellerId', b.seller_id, 'sellerName', b.seller_name,
        'productName', b.product_name_snapshot, 'variantName', b.variant_snapshot, 'trackingCode', b.tracking_code,
        'referencePriceCents', b.reference_price_cents, 'salePriceCents', b.sale_price_cents,
        'priceDifferenceCents', b.price_difference_cents, 'baseCommissionCents', b.base_commission_cents,
        'sellerDifferenceShareCents', b.seller_difference_share_cents, 'finalCommissionCents', b.final_commission_cents,
        'status', b.status, 'calculatedAt', b.calculated_at, 'eligibleAt', b.eligible_at, 'soldAt', b.sold_at
      ) order by b.calculated_at desc)
      from base b
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;
revoke all on function public.admin_commission_list(text, text, uuid, uuid, date, date, int, int) from public, anon;
grant execute on function public.admin_commission_list(text, text, uuid, uuid, date, date, int, int) to authenticated;

-- Resumen de comisión de UNA venta — vendedor dueño o admin. Proyección
-- segura: nunca expone config de stock de otras unidades del catálogo.
create or replace function public.sale_commission_summary(p_sale_id uuid)
returns jsonb
language sql
security invoker
set search_path = public
stable
as $$
  select jsonb_build_object(
    'totalCents', coalesce((select sum(final_commission_cents) from public.sale_commissions where sale_id = p_sale_id), 0),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'saleUnitId', sc.sale_unit_id,
        'productName', su.product_name_snapshot, 'variantName', su.variant_snapshot,
        'referencePriceCents', sc.reference_price_cents, 'salePriceCents', sc.sale_price_cents,
        'priceDifferenceCents', sc.price_difference_cents, 'baseCommissionCents', sc.base_commission_cents,
        'sellerDifferenceShareCents', sc.seller_difference_share_cents, 'finalCommissionCents', sc.final_commission_cents,
        'status', sc.status, 'eligibleAt', sc.eligible_at
      ) order by su.position)
      from public.sale_commissions sc
      join public.sale_units su on su.id = sc.sale_unit_id
      where sc.sale_id = p_sale_id
        and (public.sale_is_own(p_sale_id) or public.is_admin())
    ), '[]'::jsonb)
  )
  where public.sale_is_own(p_sale_id) or public.is_admin();
$$;
revoke all on function public.sale_commission_summary(uuid) from public, anon;
grant execute on function public.sale_commission_summary(uuid) to authenticated;

create or replace function public.seller_commission_kpis()
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

  return jsonb_build_object(
    'ok', true,
    'pendingCount', (select count(*) from public.sale_commissions where seller_id = v_uid and status = 'PENDING'),
    'eligibleCount', (select count(*) from public.sale_commissions where seller_id = v_uid and status = 'ELIGIBLE'),
    'pendingAmountCents', (select coalesce(sum(final_commission_cents), 0) from public.sale_commissions where seller_id = v_uid and status = 'PENDING'),
    'eligibleAmountCents', (select coalesce(sum(final_commission_cents), 0) from public.sale_commissions where seller_id = v_uid and status = 'ELIGIBLE')
  );
end;
$$;
revoke all on function public.seller_commission_kpis() from public, anon;
grant execute on function public.seller_commission_kpis() to authenticated;

create or replace function public.seller_commission_list(p_limit int default 30, p_offset int default 0)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_uid uuid := auth.uid();
  v_limit int := greatest(1, least(coalesce(p_limit, 30), 100));
  v_offset int := greatest(0, coalesce(p_offset, 0));
  v_total int;
  v_result jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;

  select count(*) into v_total from public.sale_commissions where seller_id = v_uid;

  with base as (
    select sc.*, s.sale_number, s.sold_at, su.product_name_snapshot, su.variant_snapshot
    from public.sale_commissions sc
    join public.sales s on s.id = sc.sale_id
    join public.sale_units su on su.id = sc.sale_unit_id
    where sc.seller_id = v_uid
    order by sc.calculated_at desc
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'ok', true, 'total', v_total,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'commissionId', b.id, 'saleId', b.sale_id, 'saleNumber', b.sale_number, 'soldAt', b.sold_at,
        'productName', b.product_name_snapshot, 'variantName', b.variant_snapshot,
        'referencePriceCents', b.reference_price_cents, 'salePriceCents', b.sale_price_cents,
        'priceDifferenceCents', b.price_difference_cents, 'baseCommissionCents', b.base_commission_cents,
        'sellerDifferenceShareCents', b.seller_difference_share_cents, 'finalCommissionCents', b.final_commission_cents,
        'status', b.status, 'eligibleAt', b.eligible_at
      ) order by b.calculated_at desc)
      from base b
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;
revoke all on function public.seller_commission_list(int, int) from public, anon;
grant execute on function public.seller_commission_list(int, int) to authenticated;
