-- ===========================================================================
-- ADMIN · LOGÍSTICA / ENVÍOS — ciclo operativo INDEPENDIENTE del estado
-- comercial de la venta. `sales.status` NUNCA se lee ni se escribe aquí más
-- allá de condicionar cuándo se inicializa la logística; nunca se cambia
-- automáticamente en ninguna dirección (una venta PAID con logística
-- IN_TRANSIT es un estado perfectamente válido).
--
-- Nivel: UNIDAD (`sale_unit_id`), no venta. Una venta puede tener unidades
-- que se mueven físicamente por separado. El resumen a nivel de venta se
-- DERIVA en las RPC de lectura — no se persiste ningún campo nuevo en
-- `sales`.
--
-- Destino/destinatario: se reusa `sale_cuba_recipients`/`sale_deliveries`
-- EN VIVO (join por `sale_id`) — nunca se copian a logística.
--
-- Tracking: se reusa `sale_units.tracking_code` tal cual (generado en
-- `mark_sale_sold`) — no se crea un segundo identificador.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. sale_unit_logistics — un registro por sale_unit (1 a 1).
-- ---------------------------------------------------------------------------
create table public.sale_unit_logistics (
  id                    uuid primary key default gen_random_uuid(),
  sale_unit_id          uuid not null unique references public.sale_units (id) on delete cascade,
  status                text not null default 'PENDING_PREPARATION'
                          check (status in (
                            'PENDING_PREPARATION', 'READY', 'DISPATCHED', 'IN_TRANSIT', 'IN_CUBA',
                            'READY_FOR_DELIVERY', 'DELIVERED', 'ON_HOLD'
                          )),
  hold_reason           text,
  shipment_reference    text,
  container_reference   text,
  carrier_reference     text,
  estimated_delivery_date date,
  delivered_at          timestamptz,
  delivered_by          uuid references public.profiles (id),
  last_event_at         timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
comment on table public.sale_unit_logistics is
  'Ciclo operativo de envío por sale_unit — INDEPENDIENTE de sales.status. Nunca se lee/escribe sales.status desde aquí, ni al revés.';
comment on column public.sale_unit_logistics.hold_reason is
  'Obligatorio (validado en la RPC, no aquí) cuando status = ON_HOLD.';
create index sale_unit_logistics_status_idx on public.sale_unit_logistics (status);

alter table public.sale_unit_logistics enable row level security;
create policy sale_unit_logistics_select on public.sale_unit_logistics
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.sale_units su join public.sales s on s.id = su.sale_id
      where su.id = sale_unit_id and s.seller_id = auth.uid()
    )
  );
-- Sin insert/update/delete a authenticated: toda mutación pasa por RPC
-- SECURITY DEFINER (mismo patrón que sale_commissions/weekly_liquidations).

-- ---------------------------------------------------------------------------
-- 2. sale_unit_logistics_events — historial inmutable. Se distingue
--    'TRANSITIONED' (flujo normal, forward-only) de 'ON_HOLD' y 'CORRECTED'
--    (nunca se confunden en Actividad/auditoría).
-- ---------------------------------------------------------------------------
create table public.sale_unit_logistics_events (
  id             uuid primary key default gen_random_uuid(),
  sale_unit_id   uuid not null references public.sale_units (id) on delete cascade,
  event_type     text not null check (event_type in ('CREATED', 'TRANSITIONED', 'ON_HOLD', 'CORRECTED')),
  from_status    text,
  to_status      text not null,
  actor_id       uuid references public.profiles (id),
  occurred_at    timestamptz not null default now(),
  note           text,
  metadata       jsonb
);
comment on table public.sale_unit_logistics_events is
  'Historial inmutable — nunca se edita ni se borra una fila existente.';
create index sale_unit_logistics_events_unit_idx on public.sale_unit_logistics_events (sale_unit_id, occurred_at desc);
create index sale_unit_logistics_events_created_idx on public.sale_unit_logistics_events (occurred_at desc);

alter table public.sale_unit_logistics_events enable row level security;
create policy sale_unit_logistics_events_select on public.sale_unit_logistics_events
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.sale_units su join public.sales s on s.id = su.sale_id
      where su.id = sale_unit_id and s.seller_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Backfill — SOLO ventas SOLD/PAID ya existentes sin fila de logística.
--    Estado inicial PENDING_PREPARATION, `created_at`/`occurred_at` = AHORA
--    (nunca se inventa una fecha histórica). El evento deja explícito que es
--    una inicialización retroactiva, distinguible para siempre de una
--    creación real disparada por mark_sale_sold.
-- ---------------------------------------------------------------------------
insert into public.sale_unit_logistics (sale_unit_id, status)
select su.id, 'PENDING_PREPARATION'
from public.sale_units su
join public.sales s on s.id = su.sale_id
where s.operation_type = 'CUBA' and s.status in ('SOLD', 'PAID')
  and not exists (select 1 from public.sale_unit_logistics l where l.sale_unit_id = su.id)
on conflict (sale_unit_id) do nothing;

insert into public.sale_unit_logistics_events (sale_unit_id, event_type, from_status, to_status, note)
select l.sale_unit_id, 'CREATED', null, 'PENDING_PREPARATION',
  'Inicialización retroactiva (migración 20260910330000) — venta ya SOLD/PAID sin historial operativo previo disponible.'
from public.sale_unit_logistics l
join public.sale_units su on su.id = l.sale_unit_id
join public.sales s on s.id = su.sale_id
where s.operation_type = 'CUBA' and s.status in ('SOLD', 'PAID')
  and not exists (select 1 from public.sale_unit_logistics_events e where e.sale_unit_id = l.sale_unit_id);

-- ---------------------------------------------------------------------------
-- 4. mark_sale_sold — ÚNICO cambio: inicializa logística (PENDING_PREPARATION)
--    para cada sale_unit de la venta que aún no tenga fila — idempotente
--    (`on conflict do nothing`), nunca sobrescribe una fila ya avanzada.
--    Todo lo demás es EXACTAMENTE igual a la versión vigente
--    (20260910290000_admin_comisiones.sql). No se toca `sales.status` desde
--    ningún otro punto de esta migración.
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
  -- logística
  v_logistics_id uuid;
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

  -- Logística: inicializa (idempotente) la unidad operativa de cada
  -- sale_unit — INDEPENDIENTE del estado comercial que se fija abajo.
  for v_cu in select id as sale_unit_id from public.sale_units where sale_id = p_sale_id loop
    insert into public.sale_unit_logistics (sale_unit_id, status)
    values (v_cu.sale_unit_id, 'PENDING_PREPARATION')
    on conflict (sale_unit_id) do nothing
    returning id into v_logistics_id;

    if found then
      insert into public.sale_unit_logistics_events (sale_unit_id, event_type, from_status, to_status, actor_id)
      values (v_cu.sale_unit_id, 'CREATED', null, 'PENDING_PREPARATION', v_uid);
    end if;
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

-- ---------------------------------------------------------------------------
-- 5. sale_unit_logistics_status(p_sale_id) — lectura compartida Seller-o-
--    Admin, mismo patrón EXACTO que sale_unit_inventory_status. Reune
--    destino EN VIVO desde sale_cuba_recipients/sale_deliveries (nunca
--    copiado) y el timeline de eventos.
-- ---------------------------------------------------------------------------
create or replace function public.sale_unit_logistics_status(p_sale_id uuid)
returns jsonb
language sql
security invoker
set search_path = public
stable
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'saleUnitId', su.id,
    'productName', su.product_name_snapshot,
    'variantName', su.variant_snapshot,
    'trackingCode', su.tracking_code,
    'vin', iu.vin,
    'status', l.status,
    'holdReason', l.hold_reason,
    'shipmentReference', l.shipment_reference,
    'containerReference', l.container_reference,
    'carrierReference', l.carrier_reference,
    'estimatedDeliveryDate', l.estimated_delivery_date,
    'deliveredAt', l.delivered_at,
    'lastEventAt', l.last_event_at,
    'events', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'eventType', e.event_type, 'fromStatus', e.from_status, 'toStatus', e.to_status,
        'actorName', pr.full_name, 'occurredAt', e.occurred_at, 'note', e.note
      ) order by e.occurred_at desc), '[]'::jsonb)
      from public.sale_unit_logistics_events e
      left join public.profiles pr on pr.id = e.actor_id
      where e.sale_unit_id = su.id
    )
  ) order by su.position), '[]'::jsonb)
  from public.sale_units su
  left join public.inventory_units iu on iu.id = su.inventory_unit_id
  left join public.sale_unit_logistics l on l.sale_unit_id = su.id
  where su.sale_id = p_sale_id
    and (public.sale_is_own(p_sale_id) or public.is_admin());
$$;
revoke all on function public.sale_unit_logistics_status(uuid) from public, anon;
grant execute on function public.sale_unit_logistics_status(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. admin_logistics_update_status — transición NORMAL, forward-only,
--    estrictamente un paso a la vez, o entrada a ON_HOLD (motivo
--    obligatorio) desde cualquier estado activo. Nunca toca sales.status.
-- ---------------------------------------------------------------------------
create or replace function public.admin_logistics_update_status(
  p_sale_unit_id uuid, p_new_status text, p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_log public.sale_unit_logistics;
  v_new text := upper(btrim(coalesce(p_new_status, '')));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_next_normal text;
  v_now timestamptz := now();
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  select * into v_log from public.sale_unit_logistics where sale_unit_id = p_sale_unit_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'LOGISTICS_NOT_FOUND');
  end if;

  if v_new = 'ON_HOLD' then
    if v_log.status in ('DELIVERED', 'ON_HOLD') then
      return jsonb_build_object('ok', false, 'code', 'INVALID_TRANSITION');
    end if;
    if v_note is null then
      return jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
    end if;

    update public.sale_unit_logistics
    set status = 'ON_HOLD', hold_reason = v_note, last_event_at = v_now, updated_at = v_now
    where sale_unit_id = p_sale_unit_id;

    insert into public.sale_unit_logistics_events (sale_unit_id, event_type, from_status, to_status, actor_id, occurred_at, note)
    values (p_sale_unit_id, 'ON_HOLD', v_log.status, 'ON_HOLD', v_uid, v_now, v_note);

    return jsonb_build_object('ok', true, 'status', 'ON_HOLD');
  end if;

  v_next_normal := case v_log.status
    when 'PENDING_PREPARATION' then 'READY'
    when 'READY' then 'DISPATCHED'
    when 'DISPATCHED' then 'IN_TRANSIT'
    when 'IN_TRANSIT' then 'IN_CUBA'
    when 'IN_CUBA' then 'READY_FOR_DELIVERY'
    when 'READY_FOR_DELIVERY' then 'DELIVERED'
    else null
  end;

  if v_new is distinct from v_next_normal then
    return jsonb_build_object('ok', false, 'code', 'INVALID_TRANSITION', 'currentStatus', v_log.status, 'expectedNext', v_next_normal);
  end if;

  update public.sale_unit_logistics
  set status = v_new, last_event_at = v_now, updated_at = v_now, hold_reason = null,
      delivered_at = case when v_new = 'DELIVERED' then v_now else delivered_at end,
      delivered_by = case when v_new = 'DELIVERED' then v_uid else delivered_by end
  where sale_unit_id = p_sale_unit_id;

  insert into public.sale_unit_logistics_events (sale_unit_id, event_type, from_status, to_status, actor_id, occurred_at, note)
  values (p_sale_unit_id, 'TRANSITIONED', v_log.status, v_new, v_uid, v_now, v_note);

  return jsonb_build_object('ok', true, 'status', v_new);
end;
$$;
revoke all on function public.admin_logistics_update_status(uuid, text, text) from public, anon;
grant execute on function public.admin_logistics_update_status(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. admin_logistics_correct_status — corrección AUDITADA, motivo
--    obligatorio, permite cualquier estado -> cualquier otro (incluye
--    reanudar desde ON_HOLD). Nunca borra el evento original; siempre
--    inserta uno nuevo tipo CORRECTED.
-- ---------------------------------------------------------------------------
create or replace function public.admin_logistics_correct_status(
  p_sale_unit_id uuid, p_new_status text, p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_log public.sale_unit_logistics;
  v_new text := upper(btrim(coalesce(p_new_status, '')));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_now timestamptz := now();
  v_valid_statuses text[] := array['PENDING_PREPARATION','READY','DISPATCHED','IN_TRANSIT','IN_CUBA','READY_FOR_DELIVERY','DELIVERED','ON_HOLD'];
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;
  if not (v_new = any(v_valid_statuses)) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATUS');
  end if;
  if v_reason is null or length(v_reason) < 4 then
    return jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
  end if;

  select * into v_log from public.sale_unit_logistics where sale_unit_id = p_sale_unit_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'LOGISTICS_NOT_FOUND');
  end if;
  if v_new = v_log.status then
    return jsonb_build_object('ok', false, 'code', 'SAME_STATUS');
  end if;

  update public.sale_unit_logistics
  set status = v_new, last_event_at = v_now, updated_at = v_now,
      hold_reason = case when v_new = 'ON_HOLD' then v_reason else null end,
      delivered_at = case when v_new = 'DELIVERED' then v_now when v_log.status = 'DELIVERED' and v_new <> 'DELIVERED' then null else delivered_at end,
      delivered_by = case when v_new = 'DELIVERED' then v_uid when v_log.status = 'DELIVERED' and v_new <> 'DELIVERED' then null else delivered_by end
  where sale_unit_id = p_sale_unit_id;

  insert into public.sale_unit_logistics_events (sale_unit_id, event_type, from_status, to_status, actor_id, occurred_at, note)
  values (p_sale_unit_id, 'CORRECTED', v_log.status, v_new, v_uid, v_now, v_reason);

  return jsonb_build_object('ok', true, 'status', v_new);
end;
$$;
revoke all on function public.admin_logistics_correct_status(uuid, text, text) from public, anon;
grant execute on function public.admin_logistics_correct_status(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. admin_logistics_kpis — conteos actuales por estado (dashboard de
--    /admin/logistica). Solo unidades de ventas CUBA con logística.
-- ---------------------------------------------------------------------------
create or replace function public.admin_logistics_kpis()
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
    'pendingPreparation', (select count(*) from public.sale_unit_logistics where status = 'PENDING_PREPARATION'),
    'ready', (select count(*) from public.sale_unit_logistics where status = 'READY'),
    'dispatched', (select count(*) from public.sale_unit_logistics where status = 'DISPATCHED'),
    'inTransit', (select count(*) from public.sale_unit_logistics where status = 'IN_TRANSIT'),
    'inCuba', (select count(*) from public.sale_unit_logistics where status = 'IN_CUBA'),
    'readyForDelivery', (select count(*) from public.sale_unit_logistics where status = 'READY_FOR_DELIVERY'),
    'delivered', (select count(*) from public.sale_unit_logistics where status = 'DELIVERED'),
    'onHold', (select count(*) from public.sale_unit_logistics where status = 'ON_HOLD')
  );
end;
$$;
revoke all on function public.admin_logistics_kpis() from public, anon;
grant execute on function public.admin_logistics_kpis() to authenticated;

-- ---------------------------------------------------------------------------
-- 9. admin_logistics_list — bandeja operativa principal.
-- ---------------------------------------------------------------------------
create or replace function public.admin_logistics_list(
  p_status           text default 'ALL',
  p_seller_id        uuid default null,
  p_product_id       uuid default null,
  p_search           text default null,
  p_commercial_status text default 'ALL',
  p_limit            int default 50,
  p_offset           int default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_status text := coalesce(nullif(upper(btrim(p_status)), ''), 'ALL');
  v_commercial text := coalesce(nullif(upper(btrim(p_commercial_status)), ''), 'ALL');
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_limit int := greatest(1, least(coalesce(p_limit, 50), 100));
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
    select
      l.sale_unit_id, l.status as logistics_status, l.last_event_at,
      su.id as su_id, su.product_name_snapshot, su.variant_snapshot, su.tracking_code,
      s.id as sale_id, s.sale_number, s.status as sale_status, s.seller_id,
      pr.full_name as seller_name,
      iu.vin,
      rec.full_name as recipient_name, rec.province, rec.municipality
    from public.sale_unit_logistics l
    join public.sale_units su on su.id = l.sale_unit_id
    join public.sales s on s.id = su.sale_id
    join public.profiles pr on pr.id = s.seller_id
    left join public.inventory_units iu on iu.id = su.inventory_unit_id
    left join public.sale_cuba_recipients rec on rec.sale_id = s.id
    where s.operation_type = 'CUBA'
      and (v_status = 'ALL' or l.status = v_status)
      and (v_commercial = 'ALL' or s.status = v_commercial)
      and (p_seller_id is null or s.seller_id = p_seller_id)
      and (p_product_id is null or su.product_id = p_product_id)
      and (v_search is null
        or s.sale_number ilike '%' || v_search || '%'
        or su.tracking_code ilike '%' || v_search || '%'
        or iu.vin ilike '%' || v_search || '%'
        or pr.full_name ilike '%' || v_search || '%'
        or su.product_name_snapshot ilike '%' || v_search || '%'
        or rec.full_name ilike '%' || v_search || '%')
  )
  select count(*) into v_total from base;

  with base as (
    select
      l.sale_unit_id, l.status as logistics_status, l.last_event_at,
      su.id as su_id, su.product_name_snapshot, su.variant_snapshot, su.tracking_code,
      s.id as sale_id, s.sale_number, s.status as sale_status, s.seller_id,
      pr.full_name as seller_name,
      iu.vin,
      rec.full_name as recipient_name, rec.province, rec.municipality
    from public.sale_unit_logistics l
    join public.sale_units su on su.id = l.sale_unit_id
    join public.sales s on s.id = su.sale_id
    join public.profiles pr on pr.id = s.seller_id
    left join public.inventory_units iu on iu.id = su.inventory_unit_id
    left join public.sale_cuba_recipients rec on rec.sale_id = s.id
    where s.operation_type = 'CUBA'
      and (v_status = 'ALL' or l.status = v_status)
      and (v_commercial = 'ALL' or s.status = v_commercial)
      and (p_seller_id is null or s.seller_id = p_seller_id)
      and (p_product_id is null or su.product_id = p_product_id)
      and (v_search is null
        or s.sale_number ilike '%' || v_search || '%'
        or su.tracking_code ilike '%' || v_search || '%'
        or iu.vin ilike '%' || v_search || '%'
        or pr.full_name ilike '%' || v_search || '%'
        or su.product_name_snapshot ilike '%' || v_search || '%'
        or rec.full_name ilike '%' || v_search || '%')
    order by l.last_event_at desc
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'ok', true, 'total', v_total,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'saleUnitId', b.su_id, 'saleId', b.sale_id, 'saleNumber', b.sale_number, 'saleStatus', b.sale_status,
        'productName', b.product_name_snapshot, 'variantName', b.variant_snapshot,
        'vin', b.vin, 'trackingCode', b.tracking_code,
        'sellerId', b.seller_id, 'sellerName', b.seller_name,
        'destination', nullif(concat_ws(', ', b.recipient_name, b.municipality, b.province), ''),
        'logisticsStatus', b.logistics_status, 'lastEventAt', b.last_event_at
      ) order by b.last_event_at desc)
      from base b
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;
revoke all on function public.admin_logistics_list(text, uuid, uuid, text, text, int, int) from public, anon;
grant execute on function public.admin_logistics_list(text, uuid, uuid, text, text, int, int) to authenticated;
