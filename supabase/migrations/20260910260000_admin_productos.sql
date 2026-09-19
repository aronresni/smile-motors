-- ===========================================================================
-- ADMIN · PRODUCTOS — administración del catálogo (`products`/
-- `product_variants`/`product_images`) ya existente. Reutiliza el esquema
-- relacional y las políticas RLS admin (`for all using(is_admin())`) que YA
-- estaban definidas en 20260910120000_inventory_catalog.sql — no se abren
-- políticas nuevas de escritura. Se agregan solo:
--
--   1) `product_variants.is_active` (gap real: no existía — una variante
--      nunca podía "desactivarse" para ventas nuevas).
--   2) El bucket de Storage `product-images` (público, solo-lectura
--      anónima; escritura solo admin) — no existía ningún bucket de
--      imágenes de catálogo todavía.
--   3) Tabla de auditoría enfocada `product_catalog_events`.
--   4) RPCs `SECURITY DEFINER` de administración (mismo patrón que
--      Financieras/Vendedores: `is_admin()` explícito, envelope
--      `{ok,code}`, nunca solo RLS) — RLS ya permitía la escritura directa,
--      pero se mantiene el patrón por auditoría atómica y mensajes
--      consistentes.
--
-- CRÍTICO: `sale_units` ya snapshotea nombre/marca/variante/precio de lista/
-- precio Cuba al guardar (`save_cuba_sale_draft`, sin tocar). Esta migración
-- NO reescribe esa lógica de snapshot — solo agrega el filtro
-- `pv.is_active` al lookup de variante (para que TEST 5 se cumpla también
-- server-side, no solo ocultando la opción en pantalla).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. product_variants.is_active
-- ---------------------------------------------------------------------------
alter table public.product_variants
  add column if not exists is_active boolean not null default true;

comment on column public.product_variants.is_active is
  'ACTIVA = seleccionable en ventas nuevas. INACTIVA = ya no seleccionable, pero las ventas históricas que la usaron conservan su snapshot intacto.';

create index if not exists product_variants_active_idx
  on public.product_variants (product_id) where is_active;

-- ---------------------------------------------------------------------------
-- 2. save_cuba_sale_draft — el lookup de variante ahora exige is_active
--    (igual que ya exigía `p.is_active` para el producto). Único cambio al
--    flujo de venta que toca esta tarea; todo lo demás de esa función queda
--    exactamente igual.
-- ---------------------------------------------------------------------------
create or replace function public.save_cuba_sale_draft(p_sale_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_owns   boolean;
  v_unit   jsonb;
  v_extra  jsonb;
  v_prod   record;
  v_variant_label text;
  v_pos    int;
begin
  select (s.seller_id = auth.uid() and s.status = 'DRAFT')
    into v_owns
    from public.sales s
    where s.id = p_sale_id;

  if v_owns is null then
    raise exception 'venta no encontrada';
  end if;
  if not v_owns then
    raise exception 'no autorizado';
  end if;

  update public.sales set
    sale_date        = nullif(p_payload->>'saleDate', '')::date,
    share_commission = coalesce((p_payload->>'shareCommission')::boolean, false),
    internal_notes   = nullif(p_payload->>'internalNotes', '')
  where id = p_sale_id;

  -- comprador principal
  insert into public.sale_parties (
    sale_id, party_role, first_name, last_name, date_of_birth, document_number,
    document_expiration, phone, email, address_line1, address_line2, city, state,
    postal_code, country_code)
  values (
    p_sale_id, 'PRIMARY_BUYER',
    nullif(p_payload#>>'{buyer,firstName}', ''),
    nullif(p_payload#>>'{buyer,lastName}', ''),
    nullif(p_payload#>>'{buyer,dateOfBirth}', '')::date,
    nullif(p_payload#>>'{buyer,documentNumber}', ''),
    nullif(p_payload#>>'{buyer,documentExpiration}', '')::date,
    nullif(p_payload#>>'{buyer,phone}', ''),
    nullif(p_payload#>>'{buyer,email}', ''),
    nullif(p_payload#>>'{buyer,addressLine1}', ''),
    nullif(p_payload#>>'{buyer,addressLine2}', ''),
    nullif(p_payload#>>'{buyer,city}', ''),
    nullif(p_payload#>>'{buyer,state}', ''),
    nullif(p_payload#>>'{buyer,postalCode}', ''),
    'US')
  on conflict (sale_id, party_role) do update set
    first_name = excluded.first_name, last_name = excluded.last_name,
    date_of_birth = excluded.date_of_birth, document_number = excluded.document_number,
    document_expiration = excluded.document_expiration, phone = excluded.phone,
    email = excluded.email, address_line1 = excluded.address_line1,
    address_line2 = excluded.address_line2, city = excluded.city,
    state = excluded.state, postal_code = excluded.postal_code;

  -- co-comprador
  if p_payload ? 'coBuyer' and jsonb_typeof(p_payload->'coBuyer') = 'object' then
    insert into public.sale_parties (
      sale_id, party_role, first_name, last_name, date_of_birth, document_number,
      phone, email)
    values (
      p_sale_id, 'CO_BUYER',
      nullif(p_payload#>>'{coBuyer,firstName}', ''),
      nullif(p_payload#>>'{coBuyer,lastName}', ''),
      nullif(p_payload#>>'{coBuyer,dateOfBirth}', '')::date,
      nullif(p_payload#>>'{coBuyer,documentNumber}', ''),
      nullif(p_payload#>>'{coBuyer,phone}', ''),
      nullif(p_payload#>>'{coBuyer,email}', ''))
    on conflict (sale_id, party_role) do update set
      first_name = excluded.first_name, last_name = excluded.last_name,
      date_of_birth = excluded.date_of_birth, document_number = excluded.document_number,
      phone = excluded.phone, email = excluded.email;
  else
    delete from public.sale_parties where sale_id = p_sale_id and party_role = 'CO_BUYER';
  end if;

  -- unidades — ÚNICO cambio de esta migración: el lookup de variante ahora
  -- también exige `pv.is_active` (igual que ya exigía `p.is_active` para el
  -- producto). Todo lo demás de esta función es idéntico a la versión
  -- vigente (20260910190000_payment_settlement.sql).
  delete from public.sale_units where sale_id = p_sale_id;
  v_pos := 0;
  for v_unit in select * from jsonb_array_elements(coalesce(p_payload->'units', '[]'::jsonb))
  loop
    select p.id, p.name, p.brand, p.base_price_cents, p.cuba_total_cents
      into v_prod
      from public.products p
      where p.id = (v_unit->>'productId')::uuid and p.is_active;

    if v_prod.id is null then
      raise exception 'producto inválido o inactivo en la unidad %', v_pos + 1;
    end if;

    v_variant_label := null;
    if nullif(v_unit->>'variantId', '') is not null then
      select pv.color_name into v_variant_label
        from public.product_variants pv
        where pv.id = (v_unit->>'variantId')::uuid
          and pv.product_id = v_prod.id
          and pv.is_active;
      if v_variant_label is null then
        raise exception 'la variante no pertenece al producto o no está activa en la unidad %', v_pos + 1;
      end if;
    end if;

    insert into public.sale_units (
      sale_id, position, product_id, product_variant_id,
      product_name_snapshot, brand_snapshot, variant_snapshot,
      list_price_cents_snapshot, cuba_total_cents_snapshot, agreed_price_cents)
    values (
      p_sale_id, v_pos, v_prod.id, nullif(v_unit->>'variantId', '')::uuid,
      v_prod.name, v_prod.brand, v_variant_label,
      v_prod.base_price_cents, v_prod.cuba_total_cents,
      greatest(0, coalesce((v_unit->>'agreedPriceCents')::bigint, 0)));

    v_pos := v_pos + 1;
  end loop;

  -- extras
  delete from public.sale_extras where sale_id = p_sale_id;
  v_pos := 0;
  for v_extra in select * from jsonb_array_elements(coalesce(p_payload->'extras', '[]'::jsonb))
  loop
    insert into public.sale_extras (
      sale_id, description, quantity, unit_price_cents, position)
    values (
      p_sale_id,
      nullif(v_extra->>'description', ''),
      greatest(1, coalesce((v_extra->>'quantity')::int, 1)),
      greatest(0, coalesce((v_extra->>'unitAmountCents')::bigint, 0)),
      v_pos);
    v_pos := v_pos + 1;
  end loop;

  -- destinatario en Cuba
  insert into public.sale_cuba_recipients (
    sale_id, full_name, identity_number, delivery_address, municipality,
    province, primary_phone, secondary_phone)
  values (
    p_sale_id,
    nullif(p_payload#>>'{cubaRecipient,fullName}', ''),
    nullif(p_payload#>>'{cubaRecipient,identityNumber}', ''),
    nullif(p_payload#>>'{cubaRecipient,deliveryAddress}', ''),
    nullif(p_payload#>>'{cubaRecipient,municipality}', ''),
    nullif(p_payload#>>'{cubaRecipient,province}', ''),
    nullif(p_payload#>>'{cubaRecipient,phonePrimary}', ''),
    nullif(p_payload#>>'{cubaRecipient,phoneSecondary}', ''))
  on conflict (sale_id) do update set
    full_name = excluded.full_name, identity_number = excluded.identity_number,
    delivery_address = excluded.delivery_address, municipality = excluded.municipality,
    province = excluded.province, primary_phone = excluded.primary_phone,
    secondary_phone = excluded.secondary_phone;

  -- entrega
  insert into public.sale_deliveries (sale_id, method, pickup_reference, delivery_notes)
  values (
    p_sale_id,
    nullif(p_payload#>>'{delivery,method}', ''),
    nullif(p_payload#>>'{delivery,reference}', ''),
    nullif(p_payload#>>'{delivery,notes}', ''))
  on conflict (sale_id) do update set
    method = excluded.method,
    pickup_reference = excluded.pickup_reference,
    delivery_notes = excluded.delivery_notes;

  -- pagos / liquidación (recalculado autoritativamente + snapshots)
  perform public.sync_sale_payment_allocations(
    p_sale_id, coalesce(p_payload->'paymentAllocations', '[]'::jsonb));

  return jsonb_build_object(
    'saleId', p_sale_id,
    'updatedAt', (select updated_at from public.sales where id = p_sale_id),
    'ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Storage: bucket público de imágenes de catálogo. Lectura pública
--    (sin URL firmada — catálogo, no documento de identidad); escritura
--    SOLO admin. Nunca se mezcla con `sale-documents`/`sale-financing-
--    contracts` (buckets privados, sin relación).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "product-images public read" on storage.objects;
create policy "product-images public read" on storage.objects
  for select
  using (bucket_id = 'product-images');

drop policy if exists "product-images admin insert" on storage.objects;
create policy "product-images admin insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'product-images' and public.is_admin());

drop policy if exists "product-images admin update" on storage.objects;
create policy "product-images admin update" on storage.objects
  for update to authenticated
  using (bucket_id = 'product-images' and public.is_admin())
  with check (bucket_id = 'product-images' and public.is_admin());

drop policy if exists "product-images admin delete" on storage.objects;
create policy "product-images admin delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'product-images' and public.is_admin());

-- ---------------------------------------------------------------------------
-- 4. product_catalog_events — auditoría enfocada (incluye historial de
--    precio: cada PRICE_CHANGED queda disponible para armar la línea de
--    tiempo de precio sin inferirla de `sales`).
-- ---------------------------------------------------------------------------
create table public.product_catalog_events (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references public.products (id) on delete cascade,
  variant_id   uuid references public.product_variants (id) on delete set null,
  image_id     uuid,
  event_type   text not null check (event_type in (
                 'PRODUCT_CREATED', 'PRODUCT_UPDATED', 'PRODUCT_ACTIVATED', 'PRODUCT_DEACTIVATED',
                 'PRODUCT_DUPLICATED', 'PRICE_CHANGED',
                 'VARIANT_CREATED', 'VARIANT_UPDATED', 'VARIANT_ACTIVATED', 'VARIANT_DEACTIVATED',
                 'IMAGE_ADDED', 'IMAGE_REMOVED', 'PRIMARY_IMAGE_CHANGED'
               )),
  actor_id     uuid references public.profiles (id) on delete set null,
  changes      jsonb,
  created_at   timestamptz not null default now()
);
create index product_catalog_events_product_idx on public.product_catalog_events (product_id, created_at desc);
create index product_catalog_events_price_idx
  on public.product_catalog_events (product_id, created_at desc) where event_type = 'PRICE_CHANGED';

alter table public.product_catalog_events enable row level security;
grant select on public.product_catalog_events to authenticated;
create policy product_catalog_events_select_admin on public.product_catalog_events
  for select to authenticated
  using (public.is_admin());

-- ===========================================================================
-- 5. RPCs de administración — ADMIN-only, auditadas. Nunca hard-delete.
-- ===========================================================================

create or replace function public.admin_create_product(
  p_name             text,
  p_brand            text default null,
  p_category         text default null,
  p_displacement     text default null,
  p_power            text default null,
  p_engine           text default null,
  p_weight           text default null,
  p_is_active        boolean default true,
  p_stock_mode       text default null,        -- 'on_demand' | null
  p_base_price_cents bigint default null,
  p_shipping_cents   bigint default null,
  p_cuba_total_cents bigint default null,
  p_legacy_id        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_legacy text := nullif(btrim(coalesce(p_legacy_id, '')), '');
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;
  if v_name is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;
  if p_stock_mode is not null and p_stock_mode <> 'on_demand' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STOCK_MODE');
  end if;
  if coalesce(p_base_price_cents, 0) < 0 or coalesce(p_shipping_cents, 0) < 0
     or coalesce(p_cuba_total_cents, 0) < 0 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_PRICE');
  end if;
  if v_legacy is not null and exists (select 1 from public.products where legacy_id = v_legacy) then
    return jsonb_build_object('ok', false, 'code', 'LEGACY_ID_ALREADY_EXISTS');
  end if;

  insert into public.products (
    name, brand, category, displacement, power, engine, weight, is_active,
    stock_mode, base_price_cents, shipping_cents, cuba_total_cents, legacy_id)
  values (
    v_name, nullif(btrim(coalesce(p_brand, '')), ''), nullif(btrim(coalesce(p_category, '')), ''),
    nullif(btrim(coalesce(p_displacement, '')), ''), nullif(btrim(coalesce(p_power, '')), ''),
    nullif(btrim(coalesce(p_engine, '')), ''), nullif(btrim(coalesce(p_weight, '')), ''),
    coalesce(p_is_active, true), p_stock_mode, p_base_price_cents, p_shipping_cents, p_cuba_total_cents,
    v_legacy)
  returning id into v_id;

  insert into public.product_catalog_events (product_id, event_type, actor_id, changes)
  values (v_id, 'PRODUCT_CREATED', v_uid, jsonb_build_object('name', v_name));

  if coalesce(p_base_price_cents, 0) > 0 or coalesce(p_cuba_total_cents, 0) > 0 then
    insert into public.product_catalog_events (product_id, event_type, actor_id, changes)
    values (v_id, 'PRICE_CHANGED', v_uid, jsonb_build_object(
      'basePriceCentsTo', p_base_price_cents, 'cubaTotalCentsTo', p_cuba_total_cents));
  end if;

  return jsonb_build_object('ok', true, 'productId', v_id);
end;
$$;
revoke all on function public.admin_create_product(text, text, text, text, text, text, text, boolean, text, bigint, bigint, bigint, text) from public, anon;
grant execute on function public.admin_create_product(text, text, text, text, text, text, text, boolean, text, bigint, bigint, bigint, text) to authenticated;

create or replace function public.admin_update_product(
  p_product_id       uuid,
  p_name             text,
  p_brand            text default null,
  p_category         text default null,
  p_displacement     text default null,
  p_power            text default null,
  p_engine           text default null,
  p_weight           text default null,
  p_stock_mode       text default null,
  p_base_price_cents bigint default null,
  p_shipping_cents   bigint default null,
  p_cuba_total_cents bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_old public.products;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_changes jsonb := '{}'::jsonb;
  v_price_changed boolean := false;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;
  if v_name is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;
  if p_stock_mode is not null and p_stock_mode <> 'on_demand' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STOCK_MODE');
  end if;
  if coalesce(p_base_price_cents, 0) < 0 or coalesce(p_shipping_cents, 0) < 0
     or coalesce(p_cuba_total_cents, 0) < 0 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_PRICE');
  end if;

  select * into v_old from public.products where id = p_product_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'PRODUCT_NOT_FOUND');
  end if;

  if v_old.name is distinct from v_name or v_old.brand is distinct from p_brand
     or v_old.category is distinct from p_category or v_old.stock_mode is distinct from p_stock_mode then
    v_changes := v_changes || jsonb_build_object('general', jsonb_build_object(
      'from', jsonb_build_object('name', v_old.name, 'brand', v_old.brand, 'category', v_old.category, 'stockMode', v_old.stock_mode),
      'to', jsonb_build_object('name', v_name, 'brand', p_brand, 'category', p_category, 'stockMode', p_stock_mode)));
  end if;
  if v_old.base_price_cents is distinct from p_base_price_cents
     or v_old.cuba_total_cents is distinct from p_cuba_total_cents
     or v_old.shipping_cents is distinct from p_shipping_cents then
    v_price_changed := true;
  end if;

  update public.products set
    name = v_name,
    brand = nullif(btrim(coalesce(p_brand, '')), ''),
    category = nullif(btrim(coalesce(p_category, '')), ''),
    displacement = nullif(btrim(coalesce(p_displacement, '')), ''),
    power = nullif(btrim(coalesce(p_power, '')), ''),
    engine = nullif(btrim(coalesce(p_engine, '')), ''),
    weight = nullif(btrim(coalesce(p_weight, '')), ''),
    stock_mode = p_stock_mode,
    base_price_cents = p_base_price_cents,
    shipping_cents = p_shipping_cents,
    cuba_total_cents = p_cuba_total_cents
  where id = p_product_id;

  if v_changes <> '{}'::jsonb then
    insert into public.product_catalog_events (product_id, event_type, actor_id, changes)
    values (p_product_id, 'PRODUCT_UPDATED', v_uid, v_changes);
  end if;
  if v_price_changed then
    insert into public.product_catalog_events (product_id, event_type, actor_id, changes)
    values (p_product_id, 'PRICE_CHANGED', v_uid, jsonb_build_object(
      'basePriceCentsFrom', v_old.base_price_cents, 'basePriceCentsTo', p_base_price_cents,
      'cubaTotalCentsFrom', v_old.cuba_total_cents, 'cubaTotalCentsTo', p_cuba_total_cents,
      'shippingCentsFrom', v_old.shipping_cents, 'shippingCentsTo', p_shipping_cents));
  end if;

  return jsonb_build_object('ok', true, 'productId', p_product_id);
end;
$$;
revoke all on function public.admin_update_product(uuid, text, text, text, text, text, text, text, text, bigint, bigint, bigint) from public, anon;
grant execute on function public.admin_update_product(uuid, text, text, text, text, text, text, text, text, bigint, bigint, bigint) to authenticated;

create or replace function public.admin_set_product_active(p_product_id uuid, p_active boolean)
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

  select * into v_old from public.products where id = p_product_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'PRODUCT_NOT_FOUND');
  end if;
  if v_old.is_active = coalesce(p_active, true) then
    return jsonb_build_object('ok', true, 'productId', p_product_id, 'isActive', v_old.is_active);
  end if;

  update public.products set is_active = coalesce(p_active, true) where id = p_product_id;

  insert into public.product_catalog_events (product_id, event_type, actor_id)
  values (p_product_id, case when coalesce(p_active, true) then 'PRODUCT_ACTIVATED' else 'PRODUCT_DEACTIVATED' end, v_uid);

  return jsonb_build_object('ok', true, 'productId', p_product_id, 'isActive', coalesce(p_active, true));
end;
$$;
revoke all on function public.admin_set_product_active(uuid, boolean) from public, anon;
grant execute on function public.admin_set_product_active(uuid, boolean) to authenticated;

-- Duplica configuración general + precios (+ variantes opcionalmente). NUNCA
-- copia legacy_id, imágenes, inventory_units ni historial: es un producto
-- NUEVO, sin ventas ni VIN.
create or replace function public.admin_duplicate_product(p_product_id uuid, p_include_variants boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_src public.products;
  v_new_id uuid;
  v_variant record;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  select * into v_src from public.products where id = p_product_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'PRODUCT_NOT_FOUND');
  end if;

  insert into public.products (
    name, brand, category, displacement, power, engine, weight, is_active,
    stock_mode, base_price_cents, shipping_cents, cuba_total_cents)
  values (
    v_src.name || ' (copia)', v_src.brand, v_src.category, v_src.displacement, v_src.power,
    v_src.engine, v_src.weight, false, -- copia nace INACTIVA: el admin la revisa antes de publicar
    v_src.stock_mode, v_src.base_price_cents, v_src.shipping_cents, v_src.cuba_total_cents)
  returning id into v_new_id;

  if coalesce(p_include_variants, true) then
    for v_variant in select * from public.product_variants where product_id = p_product_id order by color_name
    loop
      insert into public.product_variants (product_id, color_name, color_normalized, quantity_reported, is_active)
      values (v_new_id, v_variant.color_name, v_variant.color_normalized, 0, v_variant.is_active);
    end loop;
  end if;

  insert into public.product_catalog_events (product_id, event_type, actor_id, changes)
  values (v_new_id, 'PRODUCT_DUPLICATED', v_uid, jsonb_build_object('sourceProductId', p_product_id));

  return jsonb_build_object('ok', true, 'productId', v_new_id);
end;
$$;
revoke all on function public.admin_duplicate_product(uuid, boolean) from public, anon;
grant execute on function public.admin_duplicate_product(uuid, boolean) to authenticated;

create or replace function public.admin_create_product_variant(
  p_product_id uuid, p_color_name text, p_quantity_reported integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
  v_label text := nullif(btrim(coalesce(p_color_name, '')), '');
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;
  if v_label is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;
  if not exists (select 1 from public.products where id = p_product_id) then
    return jsonb_build_object('ok', false, 'code', 'PRODUCT_NOT_FOUND');
  end if;

  insert into public.product_variants (product_id, color_name, color_normalized, quantity_reported, is_active)
  values (p_product_id, v_label, lower(btrim(v_label)), greatest(0, coalesce(p_quantity_reported, 0)), true)
  on conflict (product_id, color_normalized) do nothing
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('ok', false, 'code', 'VARIANT_ALREADY_EXISTS');
  end if;

  insert into public.product_catalog_events (product_id, variant_id, event_type, actor_id, changes)
  values (p_product_id, v_id, 'VARIANT_CREATED', v_uid, jsonb_build_object('colorName', v_label));

  return jsonb_build_object('ok', true, 'variantId', v_id);
end;
$$;
revoke all on function public.admin_create_product_variant(uuid, text, integer) from public, anon;
grant execute on function public.admin_create_product_variant(uuid, text, integer) to authenticated;

create or replace function public.admin_update_product_variant(
  p_variant_id uuid, p_color_name text, p_quantity_reported integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_old public.product_variants;
  v_label text := nullif(btrim(coalesce(p_color_name, '')), '');
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;
  if v_label is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  select * into v_old from public.product_variants where id = p_variant_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'VARIANT_NOT_FOUND');
  end if;

  update public.product_variants set
    color_name = v_label,
    color_normalized = lower(btrim(v_label)),
    quantity_reported = greatest(0, coalesce(p_quantity_reported, 0))
  where id = p_variant_id;

  insert into public.product_catalog_events (product_id, variant_id, event_type, actor_id, changes)
  values (v_old.product_id, p_variant_id, 'VARIANT_UPDATED', v_uid, jsonb_build_object(
    'from', jsonb_build_object('colorName', v_old.color_name, 'quantityReported', v_old.quantity_reported),
    'to', jsonb_build_object('colorName', v_label, 'quantityReported', p_quantity_reported)));

  return jsonb_build_object('ok', true, 'variantId', p_variant_id);
end;
$$;
revoke all on function public.admin_update_product_variant(uuid, text, integer) from public, anon;
grant execute on function public.admin_update_product_variant(uuid, text, integer) to authenticated;

create or replace function public.admin_set_product_variant_active(p_variant_id uuid, p_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_old public.product_variants;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  select * into v_old from public.product_variants where id = p_variant_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'VARIANT_NOT_FOUND');
  end if;
  if v_old.is_active = coalesce(p_active, true) then
    return jsonb_build_object('ok', true, 'variantId', p_variant_id, 'isActive', v_old.is_active);
  end if;

  update public.product_variants set is_active = coalesce(p_active, true) where id = p_variant_id;

  insert into public.product_catalog_events (product_id, variant_id, event_type, actor_id)
  values (v_old.product_id, p_variant_id,
    case when coalesce(p_active, true) then 'VARIANT_ACTIVATED' else 'VARIANT_DEACTIVATED' end, v_uid);

  return jsonb_build_object('ok', true, 'variantId', p_variant_id, 'isActive', coalesce(p_active, true));
end;
$$;
revoke all on function public.admin_set_product_variant_active(uuid, boolean) from public, anon;
grant execute on function public.admin_set_product_variant_active(uuid, boolean) to authenticated;

-- Registra una imagen YA subida a Storage (el navegador sube directo al
-- bucket `product-images`; esta RPC solo materializa la fila + auditoría).
create or replace function public.admin_add_product_image(p_product_id uuid, p_storage_path text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
  v_path text := nullif(btrim(coalesce(p_storage_path, '')), '');
  v_next_pos int;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;
  if v_path is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;
  if not exists (select 1 from public.products where id = p_product_id) then
    return jsonb_build_object('ok', false, 'code', 'PRODUCT_NOT_FOUND');
  end if;

  select coalesce(max(position), -1) + 1 into v_next_pos
    from public.product_images where product_id = p_product_id;

  insert into public.product_images (product_id, storage_path, position)
  values (p_product_id, v_path, v_next_pos)
  returning id into v_id;

  insert into public.product_catalog_events (product_id, image_id, event_type, actor_id)
  values (p_product_id, v_id, 'IMAGE_ADDED', v_uid);

  return jsonb_build_object('ok', true, 'imageId', v_id, 'position', v_next_pos);
end;
$$;
revoke all on function public.admin_add_product_image(uuid, text) from public, anon;
grant execute on function public.admin_add_product_image(uuid, text) to authenticated;

-- Quita la FILA de catálogo (y devuelve la ruta para que el cliente borre el
-- objeto de Storage con su propia sesión admin). Nunca borra el archivo
-- desde SQL (Storage no es accesible desde plpgsql).
create or replace function public.admin_remove_product_image(p_image_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_old public.product_images;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  select * into v_old from public.product_images where id = p_image_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'IMAGE_NOT_FOUND');
  end if;

  delete from public.product_images where id = p_image_id;

  insert into public.product_catalog_events (product_id, event_type, actor_id, changes)
  values (v_old.product_id, 'IMAGE_REMOVED', v_uid, jsonb_build_object('storagePath', v_old.storage_path));

  return jsonb_build_object('ok', true, 'storagePath', v_old.storage_path);
end;
$$;
revoke all on function public.admin_remove_product_image(uuid) from public, anon;
grant execute on function public.admin_remove_product_image(uuid) to authenticated;

-- "Imagen principal" = position 0 (no se agrega una columna `is_primary`
-- redundante). Reordena el resto manteniendo el orden relativo anterior.
create or replace function public.admin_set_primary_product_image(p_image_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_img public.product_images;
  v_other record;
  v_pos int;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  select * into v_img from public.product_images where id = p_image_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'IMAGE_NOT_FOUND');
  end if;
  if v_img.position = 0 then
    return jsonb_build_object('ok', true, 'imageId', p_image_id);
  end if;

  v_pos := 1;
  for v_other in
    select id from public.product_images
    where product_id = v_img.product_id and id <> p_image_id
    order by position
  loop
    update public.product_images set position = v_pos where id = v_other.id;
    v_pos := v_pos + 1;
  end loop;
  update public.product_images set position = 0 where id = p_image_id;

  insert into public.product_catalog_events (product_id, image_id, event_type, actor_id)
  values (v_img.product_id, p_image_id, 'PRIMARY_IMAGE_CHANGED', v_uid);

  return jsonb_build_object('ok', true, 'imageId', p_image_id);
end;
$$;
revoke all on function public.admin_set_primary_product_image(uuid) from public, anon;
grant execute on function public.admin_set_primary_product_image(uuid) to authenticated;

create or replace function public.admin_reorder_product_images(p_product_id uuid, p_ordered_image_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
  v_pos int := 0;
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

  foreach v_id in array coalesce(p_ordered_image_ids, array[]::uuid[]) loop
    update public.product_images set position = v_pos
    where id = v_id and product_id = p_product_id;
    v_pos := v_pos + 1;
  end loop;

  return jsonb_build_object('ok', true, 'productId', p_product_id);
end;
$$;
revoke all on function public.admin_reorder_product_images(uuid, uuid[]) from public, anon;
grant execute on function public.admin_reorder_product_images(uuid, uuid[]) to authenticated;

-- ===========================================================================
-- 6. admin_product_list — listado con resumen de stock/variantes (ADMIN).
-- ===========================================================================
create or replace function public.admin_product_list(
  p_search   text default null,
  p_status   text default 'ALL',    -- ALL | ACTIVE | INACTIVE
  p_category text default 'ALL'
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
  v_category text := nullif(btrim(coalesce(p_category, '')), '');
  v_result jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  with base as (
    select p.*
    from public.products p
    where (v_status = 'ALL' or (v_status = 'ACTIVE' and p.is_active) or (v_status = 'INACTIVE' and not p.is_active))
      and (v_category is null or v_category = 'ALL' or p.category = v_category)
      and (
        v_search is null
        or p.name ilike '%' || v_search || '%'
        or p.brand ilike '%' || v_search || '%'
        or p.displacement ilike '%' || v_search || '%'
        or p.legacy_id ilike '%' || v_search || '%'
      )
  )
  select jsonb_build_object(
    'ok', true,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'productId', b.id,
        'legacyId', b.legacy_id,
        'name', b.name,
        'brand', b.brand,
        'category', b.category,
        'isActive', b.is_active,
        'stockMode', b.stock_mode,
        'basePriceCents', b.base_price_cents,
        'cubaTotalCents', b.cuba_total_cents,
        'variantCount', (select count(*) from public.product_variants v where v.product_id = b.id and v.is_active),
        'availableCount', (select count(*) from public.inventory_units iu where iu.product_id = b.id and iu.status = 'AVAILABLE'),
        'reservedCount', (select count(*) from public.inventory_units iu where iu.product_id = b.id and iu.status = 'RESERVED'),
        'soldCount', (select count(*) from public.inventory_units iu where iu.product_id = b.id and iu.status = 'SOLD')
      ) order by b.name)
      from base b
    ), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(distinct category order by category)
      from public.products where category is not null
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;
revoke all on function public.admin_product_list(text, text, text) from public, anon;
grant execute on function public.admin_product_list(text, text, text) to authenticated;

-- ===========================================================================
-- 7. admin_product_detail — ficha completa (ADMIN).
-- ===========================================================================
create or replace function public.admin_product_detail(p_product_id uuid)
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
  if not exists (select 1 from public.products where id = p_product_id) then
    return jsonb_build_object('ok', false, 'code', 'PRODUCT_NOT_FOUND');
  end if;

  select jsonb_build_object(
    'ok', true,
    'product', (select to_jsonb(p.*) from public.products p where p.id = p_product_id),
    'variants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id, 'colorName', v.color_name, 'quantityReported', v.quantity_reported,
        'isActive', v.is_active,
        'vinCount', (select count(*) from public.inventory_units iu where iu.variant_id = v.id),
        'salesUsingCount', (select count(*) from public.sale_units su where su.product_variant_id = v.id)
      ) order by v.color_name)
      from public.product_variants v where v.product_id = p_product_id
    ), '[]'::jsonb),
    'images', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'storagePath', i.storage_path, 'legacyPath', i.legacy_path, 'position', i.position
      ) order by i.position)
      from public.product_images i where i.product_id = p_product_id
    ), '[]'::jsonb),
    'inventorySummary', (
      select jsonb_build_object(
        'available', count(*) filter (where status = 'AVAILABLE'),
        'reserved', count(*) filter (where status = 'RESERVED'),
        'sold', count(*) filter (where status = 'SOLD'),
        'unavailable', count(*) filter (where status = 'UNAVAILABLE'),
        'totalVinUnits', count(*),
        'quantityReportedTotal', (select coalesce(sum(quantity_reported), 0) from public.product_variants where product_id = p_product_id),
        'isOnDemand', (select stock_mode = 'on_demand' from public.products where id = p_product_id)
      )
      from public.inventory_units where product_id = p_product_id
    ),
    'salesUsingCount', (select count(distinct sale_id) from public.sale_units where product_id = p_product_id),
    'priceHistory', coalesce((
      select jsonb_agg(jsonb_build_object(
        'basePriceCents', e.changes->>'basePriceCentsTo',
        'cubaTotalCents', e.changes->>'cubaTotalCentsTo',
        'changedAt', e.created_at,
        'actorName', (select pr.full_name from public.profiles pr where pr.id = e.actor_id)
      ) order by e.created_at desc)
      from public.product_catalog_events e
      where e.product_id = p_product_id and e.event_type = 'PRICE_CHANGED'
    ), '[]'::jsonb),
    'recentEvents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'eventType', e.event_type,
        'actorName', (select pr.full_name from public.profiles pr where pr.id = e.actor_id),
        'variantLabel', (select v.color_name from public.product_variants v where v.id = e.variant_id),
        'changes', e.changes,
        'createdAt', e.created_at
      ) order by e.created_at desc)
      from (
        select * from public.product_catalog_events
        where product_id = p_product_id
        order by created_at desc
        limit 30
      ) e
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;
revoke all on function public.admin_product_detail(uuid) from public, anon;
grant execute on function public.admin_product_detail(uuid) to authenticated;
