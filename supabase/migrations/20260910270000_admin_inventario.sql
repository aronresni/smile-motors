-- ===========================================================================
-- ADMIN · INVENTARIO / VIN — administración de `inventory_units` ya
-- existente, sin tablas de catálogo paralelas. Reutiliza `stock_mode`
-- ('on_demand' | null), el enum de estado ya presente
-- (AVAILABLE/RESERVED/SOLD/UNAVAILABLE) y la unicidad de VIN YA forzada por
-- `inventory_units_vin_key`. Se agrega solo lo que genuinamente falta:
--
--   1) Único unique index nuevo: `sale_units.inventory_unit_id` no tenía
--      NINGUNA restricción de unicidad — una unidad física podía terminar
--      asociada a dos `sale_units` a la vez. Esto es el único cambio de
--      esquema en `sale_units`.
--   2) `inventory_unit_events` — historial/auditoría enfocada (no existía).
--   3) RPCs `SECURITY DEFINER` de administración + una RPC de LECTURA
--      compartida vendedor-o-admin, muy acotada (nunca expone stock del
--      resto del catálogo a un vendedor).
--   4) Extensión ADITIVA de `mark_sale_sold`: al confirmar la venta, las
--      unidades RESERVED asociadas pasan a SOLD (ver razonamiento en el
--      informe de inspección — el enum ya anticipaba 'SOLD' y
--      `mark_sale_sold` ya es el punto donde se cierran otros identificadores
--      de unidad, como `tracking_code`). Nada más de esa función cambia.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Unicidad: una unidad física no puede estar en dos `sale_units` activas
--    a la vez. Protección de concurrencia DE VERDAD (no solo aplicación).
-- ---------------------------------------------------------------------------
create unique index if not exists sale_units_inventory_unit_unique
  on public.sale_units (inventory_unit_id)
  where inventory_unit_id is not null;

create index if not exists inventory_units_status_idx on public.inventory_units (status);

-- ---------------------------------------------------------------------------
-- 2. inventory_unit_events — historial enfocado (no existe auditoría global
--    todavía; se reutilizará cuando exista, como en Financieras/Productos).
-- ---------------------------------------------------------------------------
create table public.inventory_unit_events (
  id                uuid primary key default gen_random_uuid(),
  inventory_unit_id uuid not null references public.inventory_units (id) on delete cascade,
  event_type        text not null check (event_type in (
                       'UNIT_CREATED', 'UNIT_IMPORTED', 'VIN_UPDATED',
                       'UNIT_RESERVED', 'RESERVATION_RELEASED', 'UNIT_SOLD'
                     )),
  actor_id          uuid references public.profiles (id) on delete set null,
  from_status       text,
  to_status         text,
  sale_id           uuid references public.sales (id) on delete set null,
  sale_unit_id      uuid references public.sale_units (id) on delete set null,
  reason            text,
  changes           jsonb,
  created_at        timestamptz not null default now()
);
create index inventory_unit_events_unit_idx on public.inventory_unit_events (inventory_unit_id, created_at desc);

alter table public.inventory_unit_events enable row level security;
grant select on public.inventory_unit_events to authenticated;
create policy inventory_unit_events_select_admin on public.inventory_unit_events
  for select to authenticated
  using (public.is_admin());

-- Backfill informativo: una fila UNIT_IMPORTED por cada VIN ya existente,
-- para que el historial nunca aparezca vacío para inventario importado
-- (no se inventa ningún dato — solo se registra que ya existía).
insert into public.inventory_unit_events (inventory_unit_id, event_type, to_status, created_at)
select id, 'UNIT_IMPORTED', status, created_at from public.inventory_units;

-- ===========================================================================
-- 3. RPCs de administración — ADMIN-only, auditadas. Nunca hard-delete.
-- ===========================================================================

create or replace function public.admin_create_inventory_unit(
  p_product_id uuid, p_variant_id uuid default null, p_vin text default null, p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
  v_vin text := nullif(upper(btrim(coalesce(p_vin, ''))), '');
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;
  if v_vin is null then
    return jsonb_build_object('ok', false, 'code', 'VIN_REQUIRED');
  end if;
  if not exists (select 1 from public.products where id = p_product_id) then
    return jsonb_build_object('ok', false, 'code', 'PRODUCT_NOT_FOUND');
  end if;
  if p_variant_id is not null and not exists (
    select 1 from public.product_variants where id = p_variant_id and product_id = p_product_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'VARIANT_MISMATCH');
  end if;

  begin
    insert into public.inventory_units (product_id, variant_id, vin, note, status)
    values (p_product_id, p_variant_id, v_vin, nullif(btrim(coalesce(p_note, '')), ''), 'AVAILABLE')
    returning id into v_id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'VIN_DUPLICATE');
  end;

  insert into public.inventory_unit_events (inventory_unit_id, event_type, actor_id, to_status)
  values (v_id, 'UNIT_CREATED', v_uid, 'AVAILABLE');

  return jsonb_build_object('ok', true, 'inventoryUnitId', v_id);
end;
$$;
revoke all on function public.admin_create_inventory_unit(uuid, uuid, text, text) from public, anon;
grant execute on function public.admin_create_inventory_unit(uuid, uuid, text, text) to authenticated;

-- Alta masiva: reporta el resultado de CADA VIN (nunca descarta en
-- silencio). Una fila fallida (duplicado) no aborta el resto del lote.
create or replace function public.admin_bulk_create_inventory_units(
  p_product_id uuid, p_variant_id uuid default null, p_vins text[] default array[]::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_raw text;
  v_vin text;
  v_seen text[] := array[]::text[];
  v_id uuid;
  v_created jsonb := '[]'::jsonb;
  v_duplicate jsonb := '[]'::jsonb;
  v_invalid jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;
  if not exists (select 1 from public.products where id = p_product_id) then
    return jsonb_build_object('ok', false, 'code', 'PRODUCT_NOT_FOUND');
  end if;
  if p_variant_id is not null and not exists (
    select 1 from public.product_variants where id = p_variant_id and product_id = p_product_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'VARIANT_MISMATCH');
  end if;

  foreach v_raw in array coalesce(p_vins, array[]::text[]) loop
    v_vin := nullif(upper(btrim(coalesce(v_raw, ''))), '');

    if v_vin is null then
      v_invalid := v_invalid || jsonb_build_object('input', v_raw, 'reason', 'EMPTY');
      continue;
    end if;
    if v_vin = any(v_seen) then
      v_duplicate := v_duplicate || jsonb_build_object('vin', v_vin, 'reason', 'DUPLICATE_IN_BATCH');
      continue;
    end if;
    v_seen := array_append(v_seen, v_vin);

    begin
      insert into public.inventory_units (product_id, variant_id, vin, status)
      values (p_product_id, p_variant_id, v_vin, 'AVAILABLE')
      returning id into v_id;
      v_created := v_created || jsonb_build_object('vin', v_vin, 'inventoryUnitId', v_id);
      insert into public.inventory_unit_events (inventory_unit_id, event_type, actor_id, to_status)
      values (v_id, 'UNIT_CREATED', v_uid, 'AVAILABLE');
    exception when unique_violation then
      v_duplicate := v_duplicate || jsonb_build_object('vin', v_vin, 'reason', 'ALREADY_EXISTS');
    end;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'createdCount', jsonb_array_length(v_created),
    'duplicateCount', jsonb_array_length(v_duplicate),
    'invalidCount', jsonb_array_length(v_invalid),
    'created', v_created, 'duplicate', v_duplicate, 'invalid', v_invalid);
end;
$$;
revoke all on function public.admin_bulk_create_inventory_units(uuid, uuid, text[]) from public, anon;
grant execute on function public.admin_bulk_create_inventory_units(uuid, uuid, text[]) to authenticated;

-- Corrección de VIN — regla dependiente del estado (ver informe):
--   AVAILABLE: corrección simple, motivo opcional.
--   RESERVED/SOLD: motivo OBLIGATORIO (acción explícita y auditada).
-- Nunca reescribe en silencio un VIN histórico de una unidad SOLD.
create or replace function public.admin_update_inventory_vin(p_unit_id uuid, p_new_vin text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_old public.inventory_units;
  v_vin text := nullif(upper(btrim(coalesce(p_new_vin, ''))), '');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;
  if v_vin is null then
    return jsonb_build_object('ok', false, 'code', 'VIN_REQUIRED');
  end if;

  select * into v_old from public.inventory_units where id = p_unit_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'UNIT_NOT_FOUND');
  end if;
  if v_old.status in ('RESERVED', 'SOLD') and v_reason is null then
    return jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
  end if;
  if v_old.vin = v_vin then
    return jsonb_build_object('ok', true, 'inventoryUnitId', p_unit_id, 'unchanged', true);
  end if;

  begin
    update public.inventory_units set vin = v_vin where id = p_unit_id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'VIN_DUPLICATE');
  end;

  insert into public.inventory_unit_events (inventory_unit_id, event_type, actor_id, reason, changes)
  values (p_unit_id, 'VIN_UPDATED', v_uid, v_reason, jsonb_build_object('from', v_old.vin, 'to', v_vin));

  return jsonb_build_object('ok', true, 'inventoryUnitId', p_unit_id);
end;
$$;
revoke all on function public.admin_update_inventory_vin(uuid, text, text) from public, anon;
grant execute on function public.admin_update_inventory_vin(uuid, text, text) to authenticated;

-- ASIGNAR VIN — atómico y concurrency-safe: el UPDATE...WHERE status=
-- 'AVAILABLE' es la única fuente de verdad (nunca un SELECT previo +
-- UPDATE separado, que sería vulnerable a una carrera entre dos admins).
create or replace function public.admin_assign_inventory_vin(p_sale_unit_id uuid, p_inventory_unit_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_su  record;
  v_reserved_id uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  select su.id, su.sale_id, su.product_id, su.product_variant_id, su.inventory_unit_id
    into v_su
    from public.sale_units su
    where su.id = p_sale_unit_id
    for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'SALE_UNIT_NOT_FOUND');
  end if;
  if v_su.inventory_unit_id is not null then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_ASSIGNED');
  end if;

  -- Protección de producto/variante incorrectos: server-side, nunca solo
  -- filtrado del desplegable en el navegador (TEST 6).
  if not exists (
    select 1 from public.inventory_units iu
    where iu.id = p_inventory_unit_id
      and iu.product_id = v_su.product_id
      and (v_su.product_variant_id is null or iu.variant_id = v_su.product_variant_id)
  ) then
    return jsonb_build_object('ok', false, 'code', 'PRODUCT_VARIANT_MISMATCH');
  end if;

  -- Único UPDATE atómico: si otra sesión ya la reservó, WHERE status=
  -- 'AVAILABLE' no matchea ninguna fila → 0 filas → conflicto detectado
  -- sin ninguna ventana de carrera (TEST 7 / TEST 12).
  update public.inventory_units
  set status = 'RESERVED'
  where id = p_inventory_unit_id and status = 'AVAILABLE'
  returning id into v_reserved_id;

  if v_reserved_id is null then
    return jsonb_build_object('ok', false, 'code', 'VIN_NOT_AVAILABLE');
  end if;

  begin
    update public.sale_units set inventory_unit_id = v_reserved_id where id = p_sale_unit_id;
  exception when unique_violation then
    -- No debería ocurrir (ya se validó inventory_unit_id is null arriba y
    -- el índice único cubre la misma condición), pero si ocurre, revierte
    -- la reserva para no dejar un VIN huérfano en RESERVED.
    update public.inventory_units set status = 'AVAILABLE' where id = v_reserved_id;
    return jsonb_build_object('ok', false, 'code', 'ALREADY_ASSIGNED');
  end;

  insert into public.inventory_unit_events (
    inventory_unit_id, event_type, actor_id, from_status, to_status, sale_id, sale_unit_id)
  values (v_reserved_id, 'UNIT_RESERVED', v_uid, 'AVAILABLE', 'RESERVED', v_su.sale_id, p_sale_unit_id);

  return jsonb_build_object('ok', true, 'inventoryUnitId', v_reserved_id, 'saleUnitId', p_sale_unit_id);
end;
$$;
revoke all on function public.admin_assign_inventory_vin(uuid, uuid) from public, anon;
grant execute on function public.admin_assign_inventory_vin(uuid, uuid) to authenticated;

-- LIBERAR VIN — solo mientras RESERVED (nunca libera un SOLD por esta vía).
create or replace function public.admin_release_inventory_vin(p_sale_unit_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_su  record;
  v_unit public.inventory_units;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;
  if v_reason is null then
    return jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
  end if;

  select su.id, su.sale_id, su.inventory_unit_id into v_su
    from public.sale_units su where su.id = p_sale_unit_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'SALE_UNIT_NOT_FOUND');
  end if;
  if v_su.inventory_unit_id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_ASSIGNED');
  end if;

  select * into v_unit from public.inventory_units where id = v_su.inventory_unit_id for update;
  if v_unit.status <> 'RESERVED' then
    return jsonb_build_object('ok', false, 'code', 'NOT_RELEASABLE');
  end if;

  update public.inventory_units set status = 'AVAILABLE' where id = v_unit.id;
  update public.sale_units set inventory_unit_id = null where id = p_sale_unit_id;

  insert into public.inventory_unit_events (
    inventory_unit_id, event_type, actor_id, from_status, to_status, sale_id, sale_unit_id, reason)
  values (v_unit.id, 'RESERVATION_RELEASED', v_uid, 'RESERVED', 'AVAILABLE', v_su.sale_id, p_sale_unit_id, v_reason);

  return jsonb_build_object('ok', true, 'inventoryUnitId', v_unit.id);
end;
$$;
revoke all on function public.admin_release_inventory_vin(uuid, text) from public, anon;
grant execute on function public.admin_release_inventory_vin(uuid, text) to authenticated;

-- ===========================================================================
-- 4. Lectura — ADMIN (listado/detalle/KPIs/reconciliación) y
--    compartida SELLER-u-ADMIN acotada a una venta (nunca stock global).
-- ===========================================================================

create or replace function public.admin_inventory_kpis()
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
    'available', (select count(*) from public.inventory_units where status = 'AVAILABLE'),
    'reserved', (select count(*) from public.inventory_units where status = 'RESERVED'),
    'sold', (select count(*) from public.inventory_units where status = 'SOLD'),
    'onDemandProducts', (select count(*) from public.products where stock_mode = 'on_demand'),
    'discrepancyProducts', (
      -- Subconsultas escalares por producto (nunca un join cruzado
      -- variantes×VIN en la misma fila: eso infla ambos conteos).
      select count(*)
      from public.products p
      join lateral (
        select coalesce(sum(quantity_reported), 0) as total
        from public.product_variants where product_id = p.id
      ) reported on true
      join lateral (
        select count(*) as total from public.inventory_units where product_id = p.id
      ) vin on true
      where reported.total <> vin.total
    )
  );
end;
$$;
revoke all on function public.admin_inventory_kpis() from public, anon;
grant execute on function public.admin_inventory_kpis() to authenticated;

create or replace function public.admin_inventory_list(
  p_search      text default null,
  p_status      text default 'ALL',
  p_product_id  uuid default null,
  p_variant_id  uuid default null,
  p_stock_mode  text default 'ALL',
  p_limit       int default 50,
  p_offset      int default 0
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
  v_stock_mode text := coalesce(nullif(upper(btrim(p_stock_mode)), ''), 'ALL');
  v_limit int := greatest(1, least(coalesce(p_limit, 50), 200));
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
    select iu.*, p.name as product_name, p.legacy_id as product_legacy_id, p.stock_mode,
           pv.color_name as variant_name,
           su.id as sale_unit_id, su.sale_id,
           s.sale_number, s.status as sale_status
    from public.inventory_units iu
    join public.products p on p.id = iu.product_id
    left join public.product_variants pv on pv.id = iu.variant_id
    left join public.sale_units su on su.inventory_unit_id = iu.id
    left join public.sales s on s.id = su.sale_id
    where (v_status = 'ALL' or iu.status = v_status)
      and (p_product_id is null or iu.product_id = p_product_id)
      and (p_variant_id is null or iu.variant_id = p_variant_id)
      and (v_stock_mode = 'ALL'
           or (v_stock_mode = 'ON_DEMAND' and p.stock_mode = 'on_demand')
           or (v_stock_mode = 'STOCKED' and coalesce(p.stock_mode, '') <> 'on_demand'))
      and (
        v_search is null
        or iu.vin ilike '%' || v_search || '%'
        or p.name ilike '%' || v_search || '%'
        or p.displacement ilike '%' || v_search || '%'
        or p.legacy_id ilike '%' || v_search || '%'
        or pv.color_name ilike '%' || v_search || '%'
        or s.sale_number ilike '%' || v_search || '%'
        or su.tracking_code ilike '%' || v_search || '%'
      )
  )
  select count(*) into v_total from base;

  with base as (
    select iu.*, p.name as product_name, p.legacy_id as product_legacy_id, p.stock_mode,
           pv.color_name as variant_name,
           su.id as sale_unit_id, su.sale_id,
           s.sale_number, s.status as sale_status
    from public.inventory_units iu
    join public.products p on p.id = iu.product_id
    left join public.product_variants pv on pv.id = iu.variant_id
    left join public.sale_units su on su.inventory_unit_id = iu.id
    left join public.sales s on s.id = su.sale_id
    where (v_status = 'ALL' or iu.status = v_status)
      and (p_product_id is null or iu.product_id = p_product_id)
      and (p_variant_id is null or iu.variant_id = p_variant_id)
      and (v_stock_mode = 'ALL'
           or (v_stock_mode = 'ON_DEMAND' and p.stock_mode = 'on_demand')
           or (v_stock_mode = 'STOCKED' and coalesce(p.stock_mode, '') <> 'on_demand'))
      and (
        v_search is null
        or iu.vin ilike '%' || v_search || '%'
        or p.name ilike '%' || v_search || '%'
        or p.displacement ilike '%' || v_search || '%'
        or p.legacy_id ilike '%' || v_search || '%'
        or pv.color_name ilike '%' || v_search || '%'
        or s.sale_number ilike '%' || v_search || '%'
        or su.tracking_code ilike '%' || v_search || '%'
      )
    order by iu.created_at desc
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'ok', true,
    'total', v_total,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'inventoryUnitId', b.id,
        'vin', b.vin,
        'status', b.status,
        'productId', b.product_id,
        'productName', b.product_name,
        'productLegacyId', b.product_legacy_id,
        'stockMode', b.stock_mode,
        'variantId', b.variant_id,
        'variantName', b.variant_name,
        'saleId', b.sale_id,
        'saleNumber', b.sale_number,
        'saleStatus', b.sale_status,
        'createdAt', b.created_at
      ))
      from base b
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;
revoke all on function public.admin_inventory_list(text, text, uuid, uuid, text, int, int) from public, anon;
grant execute on function public.admin_inventory_list(text, text, uuid, uuid, text, int, int) to authenticated;

create or replace function public.admin_inventory_detail(p_inventory_unit_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;
  if not exists (select 1 from public.inventory_units where id = p_inventory_unit_id) then
    return jsonb_build_object('ok', false, 'code', 'UNIT_NOT_FOUND');
  end if;

  select jsonb_build_object(
    'ok', true,
    'unit', (
      select jsonb_build_object(
        'id', iu.id, 'vin', iu.vin, 'status', iu.status, 'legacyStatus', iu.legacy_status, 'note', iu.note,
        'createdAt', iu.created_at, 'updatedAt', iu.updated_at,
        'productId', iu.product_id, 'productName', p.name, 'productLegacyId', p.legacy_id,
        'stockMode', p.stock_mode,
        'variantId', iu.variant_id, 'variantName', pv.color_name
      )
      from public.inventory_units iu
      join public.products p on p.id = iu.product_id
      left join public.product_variants pv on pv.id = iu.variant_id
      where iu.id = p_inventory_unit_id
    ),
    'saleUnit', (
      select jsonb_build_object(
        'saleUnitId', su.id, 'saleId', su.sale_id, 'saleNumber', s.sale_number,
        'saleStatus', s.status, 'trackingCode', su.tracking_code
      )
      from public.sale_units su
      join public.sales s on s.id = su.sale_id
      where su.inventory_unit_id = p_inventory_unit_id
    ),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'eventType', e.event_type,
        'actorName', (select pr.full_name from public.profiles pr where pr.id = e.actor_id),
        'fromStatus', e.from_status, 'toStatus', e.to_status,
        'saleId', e.sale_id, 'reason', e.reason, 'changes', e.changes,
        'createdAt', e.created_at
      ) order by e.created_at desc)
      from public.inventory_unit_events e
      where e.inventory_unit_id = p_inventory_unit_id
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;
revoke all on function public.admin_inventory_detail(uuid) from public, anon;
grant execute on function public.admin_inventory_detail(uuid) to authenticated;

-- Discrepancias reportado vs. VIN — informativo, sin reparación automática.
create or replace function public.admin_inventory_reconciliation()
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
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'productId', p.id,
        'productName', p.name,
        'reportedQuantity', reported.total,
        'vinCount', vin.total,
        'difference', vin.total - reported.total
      ) order by abs(vin.total - reported.total) desc)
      from public.products p
      join lateral (
        select coalesce(sum(quantity_reported), 0) as total
        from public.product_variants where product_id = p.id
      ) reported on true
      join lateral (
        select count(*) as total from public.inventory_units where product_id = p.id
      ) vin on true
      where reported.total <> vin.total
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.admin_inventory_reconciliation() from public, anon;
grant execute on function public.admin_inventory_reconciliation() to authenticated;

-- Lectura acotada compartida SELLER-o-ADMIN: solo lo necesario para MOSTRAR
-- (nunca listar) el VIN de las unidades de UNA venta. Nunca expone stock
-- del resto del catálogo a un vendedor.
create or replace function public.sale_unit_inventory_status(p_sale_id uuid)
returns jsonb
language sql
security invoker
set search_path = public
stable
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'saleUnitId', su.id,
    'productId', su.product_id,
    'variantId', su.product_variant_id,
    'stockMode', p.stock_mode,
    'inventoryUnitId', su.inventory_unit_id,
    'vin', iu.vin,
    'inventoryStatus', iu.status
  ) order by su.position), '[]'::jsonb)
  from public.sale_units su
  join public.products p on p.id = su.product_id
  left join public.inventory_units iu on iu.id = su.inventory_unit_id
  where su.sale_id = p_sale_id
    and (public.sale_is_own(p_sale_id) or public.is_admin());
$$;
revoke all on function public.sale_unit_inventory_status(uuid) from public, anon;
grant execute on function public.sale_unit_inventory_status(uuid) to authenticated;

-- ===========================================================================
-- 5. mark_sale_sold — ÚNICO cambio: al confirmar la venta, las unidades
--    RESERVED asociadas a sus `sale_units` pasan a SOLD (ver razonamiento
--    en el informe de inspección). Todo lo demás es EXACTAMENTE igual a la
--    versión vigente (20260910250000_admin_financieras.sql).
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
