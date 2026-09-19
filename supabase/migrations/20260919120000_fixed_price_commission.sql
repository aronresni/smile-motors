-- ===========================================================================
-- SMILE MOTORS · PRECIO FIJO DE VENTA + COMISIÓN FIJA.
--
-- Cada producto tiene (solo editable por un administrador, desde su ficha):
--   * PRECIO FIJO DE VENTA  = products.default_reference_price_cents
--     (precio mínimo oficial: se puede vender por encima, nunca por debajo).
--   * COMISIÓN FIJA         = products.default_base_commission_cents
--     (lo que cobra el vendedor al vender exactamente al precio fijo).
-- Las columnas conservan su nombre técnico; cambia el significado de negocio.
--
-- Comisión al marcar VENDIDA (snapshot permanente en sale_commissions):
--   ganancia_adicional = precio_de_venta - precio_fijo        (nunca < 0)
--   parte_vendedor     = floor(ganancia_adicional / 2)        (al centavo)
--   parte_tienda       = ganancia_adicional - parte_vendedor  (centavo restante)
--   comisión_final     = comisión_fija + parte_vendedor
-- Todo en centavos (bigint): sin punto flotante.
--
-- Reglas nuevas (vendedor y admin por igual, sin overrides ocultos):
--   * Un producto está CONFIGURADO solo si ambos valores existen y son > 0.
--   * No se envía a revisión ni se marca VENDIDA una venta con un producto
--     sin configurar (COMMISSION_CONFIG_MISSING / UNIT_COMMISSION_CONFIG_MISSING)
--     o con un precio de venta inferior al precio fijo
--     (UNIT_PRICE_BELOW_FIXED_PRICE).
--   * Las ediciones (admin directas, solicitudes del vendedor) validan el
--     mínimo SOLO en unidades nuevas o cuyo producto/precio cambia: contra el
--     precio fijo CONGELADO si la unidad ya tiene comisión (VENDIDA), o contra
--     el vigente del producto si no.
--   * admin_update_product_commission_defaults exige ambos valores > 0 y una
--     comisión menor que el precio.
--
-- NO se modifica ninguna comisión existente ni se cargan importes en ningún
-- producto: los productos activos sin configurar siguen en Alertas hasta que
-- un administrador los complete.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Documentación del significado de las columnas.
-- ---------------------------------------------------------------------------
comment on column public.products.default_reference_price_cents is
  'PRECIO FIJO DE VENTA (centavos): precio mínimo oficial del producto. Solo lo edita un administrador. NULL = sin configurar.';
comment on column public.products.default_base_commission_cents is
  'COMISIÓN FIJA del vendedor (centavos) al vender exactamente al precio fijo. Solo la edita un administrador. NULL = sin configurar.';
comment on column public.sale_commissions.reference_price_cents is
  'Snapshot: precio fijo de venta utilizado al marcar VENDIDA.';
comment on column public.sale_commissions.base_commission_cents is
  'Snapshot: comisión fija utilizada al marcar VENDIDA.';
comment on column public.sale_commissions.sale_price_cents is
  'Snapshot: precio final de venta.';
comment on column public.sale_commissions.price_difference_cents is
  'Snapshot: ganancia adicional = precio de venta - precio fijo (en ventas nuevas, nunca negativa).';
comment on column public.sale_commissions.seller_difference_share_cents is
  'Snapshot: parte adicional del vendedor = floor(ganancia adicional / 2). La tienda recibe el resto.';
comment on column public.sale_commissions.final_commission_cents is
  'Snapshot: comisión final pagada al vendedor = comisión fija + parte adicional del vendedor.';

-- ---------------------------------------------------------------------------
-- 2. ¿Producto configurado? Ambos valores presentes y > 0.
-- ---------------------------------------------------------------------------
create or replace function public._product_pricing_configured(p_fixed_price bigint, p_fixed_commission bigint)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(p_fixed_price, 0) > 0 and coalesce(p_fixed_commission, 0) > 0;
$$;

-- ---------------------------------------------------------------------------
-- 3. Errores de precio/configuración de las unidades de una venta.
--    Con comisión ya congelada: mínimo = precio fijo CONGELADO. Sin ella:
--    el producto debe estar configurado y el precio >= su precio fijo.
-- ---------------------------------------------------------------------------
create or replace function public._sale_pricing_errors(p_sale_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_errors text[] := array[]::text[];
  r record;
begin
  for r in
    select su.id, coalesce(su.agreed_price_cents, 0) as price,
      p.default_reference_price_cents as fixed_price,
      p.default_base_commission_cents as fixed_commission,
      sc.reference_price_cents as frozen_fixed_price
    from public.sale_units su
    left join public.products p on p.id = su.product_id
    left join public.sale_commissions sc on sc.sale_unit_id = su.id
    where su.sale_id = p_sale_id
  loop
    if r.frozen_fixed_price is not null then
      if r.price < r.frozen_fixed_price and not ('UNIT_PRICE_BELOW_FIXED_PRICE' = any(v_errors)) then
        v_errors := array_append(v_errors, 'UNIT_PRICE_BELOW_FIXED_PRICE');
      end if;
    elsif not public._product_pricing_configured(r.fixed_price, r.fixed_commission) then
      if not ('UNIT_COMMISSION_CONFIG_MISSING' = any(v_errors)) then
        v_errors := array_append(v_errors, 'UNIT_COMMISSION_CONFIG_MISSING');
      end if;
    elsif r.price < r.fixed_price and not ('UNIT_PRICE_BELOW_FIXED_PRICE' = any(v_errors)) then
      v_errors := array_append(v_errors, 'UNIT_PRICE_BELOW_FIXED_PRICE');
    end if;
  end loop;
  return v_errors;
end;
$$;
revoke all on function public._sale_pricing_errors(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Comisión faltante = producto ACTIVO sin ambos valores > 0.
-- ---------------------------------------------------------------------------
create or replace function public._commission_config_missing_rows()
returns table (
  kind text, entity_id uuid, entity_label text, product_id uuid, product_name text
)
language sql
security definer
set search_path = public
stable
as $$
  select 'PRODUCT'::text, p.id, p.name, p.id, p.name
  from public.products p
  where p.is_active
    and not public._product_pricing_configured(p.default_reference_price_cents, p.default_base_commission_cents);
$$;
revoke all on function public._commission_config_missing_rows() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Configuración (solo admin): ambos valores obligatorios y positivos.
-- ---------------------------------------------------------------------------
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
  -- Precio fijo de venta y comisión fija: ambos obligatorios, positivos y
  -- con una comisión menor que el precio. Nunca se guarda un vacío como $0.
  if p_default_reference_price_cents is null then
    return jsonb_build_object('ok', false, 'code', 'FIXED_PRICE_REQUIRED');
  end if;
  if p_default_base_commission_cents is null then
    return jsonb_build_object('ok', false, 'code', 'FIXED_COMMISSION_REQUIRED');
  end if;
  if p_default_reference_price_cents <= 0 or p_default_reference_price_cents > 100000000 then
    return jsonb_build_object('ok', false, 'code', 'FIXED_PRICE_INVALID');
  end if;
  if p_default_base_commission_cents <= 0 or p_default_base_commission_cents > 100000000 then
    return jsonb_build_object('ok', false, 'code', 'FIXED_COMMISSION_INVALID');
  end if;
  if p_default_base_commission_cents >= p_default_reference_price_cents then
    return jsonb_build_object('ok', false, 'code', 'FIXED_COMMISSION_TOO_HIGH');
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

-- ---------------------------------------------------------------------------
-- 6. Enviar a revisión: + precio fijo / comisión fija.
-- ---------------------------------------------------------------------------
create or replace function public.request_sale_review(p_sale_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_sale   public.sales;
  v_errors text[];
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
  if v_sale.seller_id <> v_uid and not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_OWNER');
  end if;
  if v_sale.operation_type <> 'CUBA' then
    return jsonb_build_object('ok', false, 'code', 'NOT_CUBA');
  end if;

  if v_sale.status = 'PENDING' then
    return jsonb_build_object('ok', true, 'alreadyPending', true, 'saleId', v_sale.id, 'status', 'PENDING');
  end if;
  if v_sale.status <> 'DRAFT' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATUS');
  end if;

  -- + precio fijo / comisión fija de cada unidad (no se envía una venta que
  -- luego no podría marcarse VENDIDA).
  v_errors := public.validate_cuba_sale_for_review(p_sale_id) || public._sale_pricing_errors(p_sale_id);
  if array_length(v_errors, 1) is not null then
    return jsonb_build_object('ok', false, 'code', 'VALIDATION_FAILED', 'errors', to_jsonb(v_errors));
  end if;

  update public.sales set
    status = 'PENDING',
    review_requested_at = now(),
    review_requested_by = v_uid
  where id = p_sale_id;

  insert into public.sale_status_history (sale_id, from_status, to_status, changed_by, reason)
  values (p_sale_id, 'DRAFT', 'PENDING', v_uid,
    case when v_sale.seller_id <> v_uid then 'Enviada a revisión por administración' end);

  return jsonb_build_object('ok', true, 'saleId', p_sale_id, 'status', 'PENDING');
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Marcar VENDIDA: mínimo + snapshot con la fórmula de precio fijo.
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
  v_below_fixed text[] := array[]::text[];
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
  -- Vendedor dueño O administrador (acción administrativa). El admin pasa
  -- EXACTAMENTE las mismas validaciones: nunca las salta.
  if v_sale.seller_id <> v_uid and not public.is_admin() then
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

  -- Precio fijo + comisión fija: cada unidad debe tener AMBOS valores (> 0)
  -- en su producto y un precio de venta >= precio fijo, ANTES de mutar nada.
  -- El admin pasa exactamente las mismas reglas (sin overrides).
  for v_cu in
    select su.id as sale_unit_id, su.agreed_price_cents,
      p.default_reference_price_cents as p_ref, p.default_base_commission_cents as p_base
    from public.sale_units su
    join public.products p on p.id = su.product_id
    where su.sale_id = p_sale_id
  loop
    if not public._product_pricing_configured(v_cu.p_ref, v_cu.p_base) then
      v_commission_missing := array_append(v_commission_missing, v_cu.sale_unit_id::text);
    elsif coalesce(v_cu.agreed_price_cents, 0) < v_cu.p_ref then
      v_below_fixed := array_append(v_below_fixed, v_cu.sale_unit_id::text);
    end if;
  end loop;
  if array_length(v_commission_missing, 1) is not null then
    return jsonb_build_object('ok', false, 'code', 'COMMISSION_CONFIG_MISSING', 'saleUnitIds', to_jsonb(v_commission_missing));
  end if;
  if array_length(v_below_fixed, 1) is not null then
    return jsonb_build_object('ok', false, 'code', 'UNIT_PRICE_BELOW_FIXED_PRICE', 'saleUnitIds', to_jsonb(v_below_fixed));
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

  -- Comisión: calcula y graba UNA vez por unidad (config ya validada arriba).
  for v_cu in
    select
      su.id as sale_unit_id, su.product_id, su.agreed_price_cents,
      p.default_reference_price_cents as p_ref, p.default_base_commission_cents as p_base
    from public.sale_units su
    join public.products p on p.id = su.product_id
    where su.sale_id = p_sale_id
  loop
    -- Origen único para comisiones NUEVAS: el PRODUCTO (snapshot al vender).
    v_ref_price := v_cu.p_ref;
    v_base_comm := v_cu.p_base;
    v_source_type := 'PRODUCT';
    v_source_id := v_cu.product_id;

    -- Ganancia adicional: nunca negativa (el precio ya se validó >= precio fijo).
    v_diff := greatest(0, v_cu.agreed_price_cents - v_ref_price);
    -- Parte del vendedor: mitad redondeada HACIA ABAJO al centavo; el centavo
    -- restante (v_diff - v_share) queda para la tienda.
    v_share := floor(v_diff / 2.0)::bigint;
    v_final := v_base_comm + v_share;

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
        'sellerShareCents', v_share, 'storeShareCents', v_diff - v_share,
        'finalCommissionCents', v_final, 'sourceType', v_source_type));
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

  insert into public.sale_status_history (sale_id, from_status, to_status, changed_by, reason)
  values (p_sale_id, 'PENDING', 'SOLD', v_uid,
    case when v_sale.seller_id <> v_uid then 'Marcada como vendida por administración' end);

  return jsonb_build_object('ok', true, 'saleId', p_sale_id, 'saleNumber', v_number,
    'status', 'SOLD', 'saleTotalCents', v_sale_total);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Motor de edición: mínimo en unidades nuevas o modificadas.
-- ---------------------------------------------------------------------------
create or replace function public.update_confirmed_cuba_sale(
  p_sale_id uuid, p_payload jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_sale   public.sales;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_group  uuid := gen_random_uuid();
  v_year   text := to_char(current_date, 'YYYY');
  v_errors text[] := array[]::text[];

  v_units_json  jsonb := case when jsonb_typeof(p_payload->'units')  = 'array' then p_payload->'units'  else '[]'::jsonb end;
  v_extras_json jsonb := case when jsonb_typeof(p_payload->'extras') = 'array' then p_payload->'extras' else '[]'::jsonb end;
  v_docs_json   jsonb := case when jsonb_typeof(p_payload->'documents') = 'array' then p_payload->'documents' else '[]'::jsonb end;

  v_old_buyer public.sale_parties;
  v_old_cb    public.sale_parties;
  v_old_rec   public.sale_cuba_recipients;
  v_old_del   public.sale_deliveries;

  v_u        jsonb;
  v_e        jsonb;
  v_d        jsonb;
  v_prod     record;
  v_variant_label text;
  v_variant_id uuid;
  v_agreed   bigint;
  v_pos      int;
  v_old_unit  public.sale_units;
  v_old_extra public.sale_extras;
  v_track    text;
  v_new_id   uuid;
  v_party_id uuid;
  v_recipient_id uuid;

  v_payload_unit_ids  uuid[];
  v_payload_extra_ids uuid[];

  v_units_total    bigint;
  v_extras_total   bigint;
  v_delivery_total bigint;
  v_sale_total     bigint;
  v_change_count   int;

  nb_first text; nb_last text; nb_dob text; nb_docnum text; nb_docexp text;
  nb_phone text; nb_email text; nb_a1 text; nb_a2 text; nb_city text; nb_state text; nb_zip text;
  ncb jsonb;
  ncb_first text; ncb_last text; ncb_dob text; ncb_docnum text; ncb_phone text; ncb_email text;
  nr_name text; nr_ci text; nr_addr text; nr_muni text; nr_prov text; nr_p1 text; nr_p2 text;
  nd_method text; nd_ref text;
  nn_notes text;
  ne_desc text; ne_qty int; ne_price bigint;

  v_acting_as_seller uuid := nullif(current_setting('motods.acting_as_seller', true), '')::uuid;
  -- Edición administrativa DIRECTA (solo `admin_update_cuba_sale` fija este
  -- GUC transaccional): habilita además DRAFT y PAID (corrección).
  v_admin_direct boolean := coalesce(current_setting('motods.admin_direct_edit', true), '') = 'on';
  -- precio fijo / comisión fija de unidades nuevas o modificadas
  v_pr_unit_id uuid;
  v_pr_old_product uuid;
  v_pr_old_price bigint;
  v_pr_frozen bigint;
  v_pr_fixed bigint;
  v_pr_commission bigint;
  v_pr_new bigint;
  v_pr_found boolean;
begin
  ----------------------------------------------------------------- FASE 1 ---
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not exists (select 1 from public.profiles where id = v_uid and is_active) then
    return jsonb_build_object('ok', false, 'code', 'PROFILE_INACTIVE');
  end if;
  if length(v_reason) < 4 then
    return jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
  end if;

  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'SALE_NOT_FOUND');
  end if;
  if v_sale.seller_id <> v_uid
     and not (public.is_admin() and v_acting_as_seller is not null and v_acting_as_seller = v_sale.seller_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_OWNER');
  end if;
  if v_sale.operation_type <> 'CUBA' then
    return jsonb_build_object('ok', false, 'code', 'NOT_CUBA');
  end if;
  if v_sale.status not in ('PENDING', 'SOLD')
     and not (v_admin_direct and public.is_admin() and v_sale.status in ('DRAFT', 'PAID')) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATUS');
  end if;

  nb_first  := btrim(coalesce(p_payload#>>'{buyer,firstName}', ''));
  nb_last   := btrim(coalesce(p_payload#>>'{buyer,lastName}', ''));
  nb_dob    := nullif(p_payload#>>'{buyer,dateOfBirth}', '');
  nb_docnum := btrim(coalesce(p_payload#>>'{buyer,documentNumber}', ''));
  nb_docexp := nullif(p_payload#>>'{buyer,documentExpiration}', '');
  nb_phone  := btrim(coalesce(p_payload#>>'{buyer,phone}', ''));
  nb_email  := btrim(coalesce(p_payload#>>'{buyer,email}', ''));
  nb_a1     := btrim(coalesce(p_payload#>>'{buyer,addressLine1}', ''));
  nb_a2     := btrim(coalesce(p_payload#>>'{buyer,addressLine2}', ''));
  nb_city   := btrim(coalesce(p_payload#>>'{buyer,city}', ''));
  nb_state  := btrim(coalesce(p_payload#>>'{buyer,state}', ''));
  nb_zip    := btrim(coalesce(p_payload#>>'{buyer,postalCode}', ''));
  if nb_first  = '' then v_errors := array_append(v_errors, 'BUYER_FIRST_NAME_MISSING'); end if;
  if nb_last   = '' then v_errors := array_append(v_errors, 'BUYER_LAST_NAME_MISSING'); end if;
  if nb_docnum = '' then v_errors := array_append(v_errors, 'BUYER_DOCUMENT_NUMBER_MISSING'); end if;
  if nb_phone  = '' then v_errors := array_append(v_errors, 'BUYER_PHONE_MISSING'); end if;

  nr_name := btrim(coalesce(p_payload#>>'{cubaRecipient,fullName}', ''));
  nr_ci   := btrim(coalesce(p_payload#>>'{cubaRecipient,identityNumber}', ''));
  nr_addr := btrim(coalesce(p_payload#>>'{cubaRecipient,deliveryAddress}', ''));
  nr_muni := btrim(coalesce(p_payload#>>'{cubaRecipient,municipality}', ''));
  nr_prov := btrim(coalesce(p_payload#>>'{cubaRecipient,province}', ''));
  nr_p1   := btrim(coalesce(p_payload#>>'{cubaRecipient,phonePrimary}', ''));
  nr_p2   := btrim(coalesce(p_payload#>>'{cubaRecipient,phoneSecondary}', ''));
  if nr_name = '' then v_errors := array_append(v_errors, 'RECIPIENT_FULL_NAME_MISSING'); end if;
  if nr_ci   = '' then v_errors := array_append(v_errors, 'RECIPIENT_IDENTITY_NUMBER_MISSING'); end if;
  if nr_addr = '' then v_errors := array_append(v_errors, 'RECIPIENT_DELIVERY_ADDRESS_MISSING'); end if;
  if nr_prov = '' then v_errors := array_append(v_errors, 'RECIPIENT_PROVINCE_MISSING'); end if;
  if nr_p1   = '' then v_errors := array_append(v_errors, 'RECIPIENT_PRIMARY_PHONE_MISSING'); end if;

  nd_method := nullif(btrim(coalesce(p_payload#>>'{delivery,method}', '')), '');
  nd_ref    := btrim(coalesce(p_payload#>>'{delivery,reference}', ''));
  if nd_method is null then
    v_errors := array_append(v_errors, 'DELIVERY_METHOD_MISSING');
  elsif nd_method not in ('HOME_DELIVERY', 'PICKUP_POINT') then
    v_errors := array_append(v_errors, 'DELIVERY_METHOD_INVALID');
  end if;

  if jsonb_array_length(v_units_json) = 0 then
    v_errors := array_append(v_errors, 'NO_UNITS');
  else
    for v_u in select * from jsonb_array_elements(v_units_json) loop
      select p.id, p.name, p.brand, p.base_price_cents, p.cuba_total_cents
        into v_prod
        from public.products p
        where p.id = nullif(v_u->>'productId', '')::uuid
          and (p.is_active or exists (
            select 1 from public.sale_units su0
            where su0.id = nullif(v_u->>'id', '')::uuid and su0.sale_id = p_sale_id and su0.product_id = p.id));
      if not found then
        v_errors := array_append(v_errors, 'UNIT_PRODUCT_INVALID');
      elsif nullif(v_u->>'variantId', '') is not null
        and not exists (
          select 1 from public.product_variants pv
          where pv.id = (v_u->>'variantId')::uuid and pv.product_id = v_prod.id) then
        v_errors := array_append(v_errors, 'UNIT_VARIANT_MISMATCH');
      end if;
      if coalesce((v_u->>'agreedPriceCents')::bigint, 0) <= 0 then
        v_errors := array_append(v_errors, 'UNIT_AGREED_PRICE_INVALID');
      end if;
      if nullif(v_u->>'id', '') is not null
        and not exists (
          select 1 from public.sale_units su
          where su.id = (v_u->>'id')::uuid and su.sale_id = p_sale_id) then
        v_errors := array_append(v_errors, 'UNIT_ID_UNKNOWN');
      end if;
    end loop;
  end if;

  -- Precio fijo (mínimo oficial) y comisión fija: SOLO unidades nuevas o cuyo
  -- producto/precio cambia (una edición no relacionada nunca se bloquea).
  -- Con comisión ya congelada (VENDIDA) el mínimo es el precio fijo CONGELADO;
  -- si no, el vigente del producto, que además debe estar configurado (salvo
  -- en BORRADOR, que se valida al enviarlo a revisión).
  for v_u in select * from jsonb_array_elements(v_units_json) loop
    v_pr_new := coalesce((v_u->>'agreedPriceCents')::bigint, 0);
    v_pr_unit_id := null;
    v_pr_old_product := null;
    v_pr_old_price := null;
    v_pr_frozen := null;
    if nullif(v_u->>'id', '') is not null then
      select su.id, su.product_id, su.agreed_price_cents
        into v_pr_unit_id, v_pr_old_product, v_pr_old_price
        from public.sale_units su
        where su.id = (v_u->>'id')::uuid and su.sale_id = p_sale_id;
    end if;
    continue when v_pr_new <= 0;
    continue when v_pr_unit_id is not null
      and v_pr_old_product is not distinct from nullif(v_u->>'productId', '')::uuid
      and v_pr_old_price is not distinct from v_pr_new;
    if v_pr_unit_id is not null then
      select sc.reference_price_cents into v_pr_frozen
        from public.sale_commissions sc where sc.sale_unit_id = v_pr_unit_id;
    end if;
    if v_pr_frozen is not null then
      if v_pr_new < v_pr_frozen and not ('UNIT_PRICE_BELOW_FIXED_PRICE' = any(v_errors)) then
        v_errors := array_append(v_errors, 'UNIT_PRICE_BELOW_FIXED_PRICE');
      end if;
      continue;
    end if;
    select p.default_reference_price_cents, p.default_base_commission_cents, true
      into v_pr_fixed, v_pr_commission, v_pr_found
      from public.products p where p.id = nullif(v_u->>'productId', '')::uuid;
    if not coalesce(v_pr_found, false) then
      null; -- producto inválido: ya informado como UNIT_PRODUCT_INVALID
    elsif not public._product_pricing_configured(v_pr_fixed, v_pr_commission) then
      if v_sale.status <> 'DRAFT' and not ('UNIT_COMMISSION_CONFIG_MISSING' = any(v_errors)) then
        v_errors := array_append(v_errors, 'UNIT_COMMISSION_CONFIG_MISSING');
      end if;
    elsif v_pr_new < v_pr_fixed and not ('UNIT_PRICE_BELOW_FIXED_PRICE' = any(v_errors)) then
      v_errors := array_append(v_errors, 'UNIT_PRICE_BELOW_FIXED_PRICE');
    end if;
    v_pr_found := false;
  end loop;

  for v_d in select * from jsonb_array_elements(v_docs_json) loop
    if v_d->>'action' = 'remove'
      and (v_d->>'subjectType') in ('BUYER', 'CUBA_RECIPIENT')
      and not exists (
        select 1 from jsonb_array_elements(v_docs_json) x
        where x->>'subjectType' = v_d->>'subjectType'
          and x->>'side' = v_d->>'side'
          and x->>'action' = 'replace') then
      v_errors := array_append(v_errors, 'REQUIRED_DOCUMENT_REMOVAL');
    end if;
  end loop;

  if array_length(v_errors, 1) is not null then
    return jsonb_build_object('ok', false, 'code', 'VALIDATION_FAILED',
      'errors', to_jsonb(v_errors));
  end if;

  ----------------------------------------------------------------- FASE 2 ---
  select * into v_old_buyer from public.sale_parties
    where sale_id = p_sale_id and party_role = 'PRIMARY_BUYER';

  perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'buyer.first_name',          'UPDATE', v_old_buyer.first_name,               nb_first);
  perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'buyer.last_name',           'UPDATE', v_old_buyer.last_name,                nb_last);
  perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'buyer.date_of_birth',       'UPDATE', v_old_buyer.date_of_birth::text,      nb_dob);
  perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'buyer.document_number',     'UPDATE', v_old_buyer.document_number,          nb_docnum);
  perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'buyer.document_expiration', 'UPDATE', v_old_buyer.document_expiration::text, nb_docexp);
  perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'buyer.phone',               'UPDATE', v_old_buyer.phone,                    nb_phone);
  perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'buyer.email',               'UPDATE', v_old_buyer.email,                    nullif(nb_email, ''));
  perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'buyer.address_line1',       'UPDATE', v_old_buyer.address_line1,            nullif(nb_a1, ''));
  perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'buyer.address_line2',       'UPDATE', v_old_buyer.address_line2,            nullif(nb_a2, ''));
  perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'buyer.city',                'UPDATE', v_old_buyer.city,                     nullif(nb_city, ''));
  perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'buyer.state',               'UPDATE', v_old_buyer.state,                    nullif(nb_state, ''));
  perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'buyer.postal_code',         'UPDATE', v_old_buyer.postal_code,              nullif(nb_zip, ''));

  update public.sale_parties set
    first_name = nb_first, last_name = nb_last,
    date_of_birth = nb_dob::date, document_number = nb_docnum,
    document_expiration = nb_docexp::date, phone = nb_phone,
    email = nullif(nb_email, ''), address_line1 = nullif(nb_a1, ''),
    address_line2 = nullif(nb_a2, ''), city = nullif(nb_city, ''),
    state = nullif(nb_state, ''), postal_code = nullif(nb_zip, '')
  where sale_id = p_sale_id and party_role = 'PRIMARY_BUYER';

  select * into v_old_cb from public.sale_parties
    where sale_id = p_sale_id and party_role = 'CO_BUYER';
  ncb := p_payload->'coBuyer';
  if ncb is not null and jsonb_typeof(ncb) = 'object' then
    ncb_first  := btrim(coalesce(ncb->>'firstName', ''));
    ncb_last   := btrim(coalesce(ncb->>'lastName', ''));
    ncb_dob    := nullif(ncb->>'dateOfBirth', '');
    ncb_docnum := btrim(coalesce(ncb->>'documentNumber', ''));
    ncb_phone  := btrim(coalesce(ncb->>'phone', ''));
    ncb_email  := btrim(coalesce(ncb->>'email', ''));
    if v_old_cb.id is null then
      perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason,
        'co_buyer', 'ADD', null, nullif(btrim(ncb_first || ' ' || ncb_last), ''));
    else
      perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'co_buyer.first_name',      'UPDATE', v_old_cb.first_name,           nullif(ncb_first, ''));
      perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'co_buyer.last_name',       'UPDATE', v_old_cb.last_name,            nullif(ncb_last, ''));
      perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'co_buyer.date_of_birth',   'UPDATE', v_old_cb.date_of_birth::text,  ncb_dob);
      perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'co_buyer.document_number', 'UPDATE', v_old_cb.document_number,      nullif(ncb_docnum, ''));
      perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'co_buyer.phone',          'UPDATE', v_old_cb.phone,               nullif(ncb_phone, ''));
      perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'co_buyer.email',          'UPDATE', v_old_cb.email,               nullif(ncb_email, ''));
    end if;
    insert into public.sale_parties (
      sale_id, party_role, first_name, last_name, date_of_birth, document_number, phone, email)
    values (
      p_sale_id, 'CO_BUYER', nullif(ncb_first, ''), nullif(ncb_last, ''), ncb_dob::date,
      nullif(ncb_docnum, ''), nullif(ncb_phone, ''), nullif(ncb_email, ''))
    on conflict (sale_id, party_role) do update set
      first_name = excluded.first_name, last_name = excluded.last_name,
      date_of_birth = excluded.date_of_birth, document_number = excluded.document_number,
      phone = excluded.phone, email = excluded.email;
  elsif v_old_cb.id is not null then
    perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason,
      'co_buyer', 'REMOVE',
      nullif(btrim(coalesce(v_old_cb.first_name, '') || ' ' || coalesce(v_old_cb.last_name, '')), ''),
      null);
    delete from public.sale_parties where sale_id = p_sale_id and party_role = 'CO_BUYER';
  end if;

  select * into v_old_rec from public.sale_cuba_recipients where sale_id = p_sale_id;
  perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'recipient.full_name',        'UPDATE', v_old_rec.full_name,        nr_name);
  perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'recipient.identity_number',  'UPDATE', v_old_rec.identity_number,  nr_ci);
  perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'recipient.delivery_address', 'UPDATE', v_old_rec.delivery_address, nr_addr);
  perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'recipient.municipality',     'UPDATE', v_old_rec.municipality,     nullif(nr_muni, ''));
  perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'recipient.province',         'UPDATE', v_old_rec.province,         nr_prov);
  perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'recipient.primary_phone',    'UPDATE', v_old_rec.primary_phone,    nr_p1);
  perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'recipient.secondary_phone',  'UPDATE', v_old_rec.secondary_phone,  nullif(nr_p2, ''));

  insert into public.sale_cuba_recipients (
    sale_id, full_name, identity_number, delivery_address, municipality,
    province, primary_phone, secondary_phone)
  values (
    p_sale_id, nr_name, nr_ci, nr_addr, nullif(nr_muni, ''),
    nr_prov, nr_p1, nullif(nr_p2, ''))
  on conflict (sale_id) do update set
    full_name = excluded.full_name, identity_number = excluded.identity_number,
    delivery_address = excluded.delivery_address, municipality = excluded.municipality,
    province = excluded.province, primary_phone = excluded.primary_phone,
    secondary_phone = excluded.secondary_phone;

  select * into v_old_del from public.sale_deliveries where sale_id = p_sale_id;
  perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'delivery.method',           'UPDATE', v_old_del.method,           nd_method);
  perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason, 'delivery.pickup_reference', 'UPDATE', v_old_del.pickup_reference, nullif(nd_ref, ''));
  insert into public.sale_deliveries (sale_id, method, pickup_reference)
  values (p_sale_id, nd_method, nullif(nd_ref, ''))
  on conflict (sale_id) do update set
    method = excluded.method, pickup_reference = excluded.pickup_reference;

  select coalesce(array_agg((u->>'id')::uuid) filter (where nullif(u->>'id', '') is not null),
                  array[]::uuid[])
    into v_payload_unit_ids
    from jsonb_array_elements(v_units_json) u;

  for v_old_unit in select * from public.sale_units where sale_id = p_sale_id loop
    if not (v_old_unit.id = any(v_payload_unit_ids)) then
      perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason,
        'units.' || v_old_unit.id::text, 'REMOVE',
        coalesce(v_old_unit.product_name_snapshot, '')
          || case when coalesce(v_old_unit.variant_snapshot, '') <> ''
                  then ' / ' || v_old_unit.variant_snapshot else '' end
          || ' @ ' || coalesce(v_old_unit.agreed_price_cents, 0)::text
          || case when v_old_unit.tracking_code is not null
                  then ' (' || v_old_unit.tracking_code || ')' else '' end,
        null);
      delete from public.sale_units where id = v_old_unit.id;
    end if;
  end loop;

  v_pos := 0;
  for v_u in select * from jsonb_array_elements(v_units_json) loop
    select p.id, p.name, p.brand, p.base_price_cents, p.cuba_total_cents
      into v_prod
      from public.products p
      where p.id = (v_u->>'productId')::uuid
        and (p.is_active or exists (
          select 1 from public.sale_units su0
          where su0.id = nullif(v_u->>'id', '')::uuid and su0.sale_id = p_sale_id and su0.product_id = p.id));

    v_variant_id := nullif(v_u->>'variantId', '')::uuid;
    v_variant_label := null;
    if v_variant_id is not null then
      select pv.color_name into v_variant_label
        from public.product_variants pv
        where pv.id = v_variant_id and pv.product_id = v_prod.id;
    end if;
    v_agreed := greatest(0, coalesce((v_u->>'agreedPriceCents')::bigint, 0));

    if nullif(v_u->>'id', '') is not null then
      select * into v_old_unit from public.sale_units where id = (v_u->>'id')::uuid;

      if v_old_unit.product_id is distinct from v_prod.id then
        perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason,
          'units.' || v_old_unit.id::text || '.product', 'UPDATE',
          v_old_unit.product_name_snapshot, v_prod.name);
      end if;
      if coalesce(v_old_unit.variant_snapshot, '') is distinct from coalesce(v_variant_label, '') then
        perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason,
          'units.' || v_old_unit.id::text || '.variant', 'UPDATE',
          v_old_unit.variant_snapshot, v_variant_label);
      end if;
      if v_old_unit.agreed_price_cents is distinct from v_agreed then
        perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason,
          'units.' || v_old_unit.id::text || '.agreed_price_cents', 'UPDATE',
          v_old_unit.agreed_price_cents::text, v_agreed::text);
      end if;

      update public.sale_units set
        position = v_pos,
        product_id = v_prod.id,
        product_variant_id = v_variant_id,
        product_name_snapshot = v_prod.name,
        brand_snapshot = v_prod.brand,
        variant_snapshot = v_variant_label,
        list_price_cents_snapshot = v_prod.base_price_cents,
        cuba_total_cents_snapshot = v_prod.cuba_total_cents,
        agreed_price_cents = v_agreed
      where id = v_old_unit.id;
    else
      v_track := case when v_sale.status in ('SOLD', 'PAID') then
        'CU-' || v_year || '-' || lpad(nextval('public.sale_unit_tracking_seq')::text, 6, '0')
        else null end;
      insert into public.sale_units (
        sale_id, position, product_id, product_variant_id,
        product_name_snapshot, brand_snapshot, variant_snapshot,
        list_price_cents_snapshot, cuba_total_cents_snapshot, agreed_price_cents, tracking_code)
      values (
        p_sale_id, v_pos, v_prod.id, v_variant_id,
        v_prod.name, v_prod.brand, v_variant_label,
        v_prod.base_price_cents, v_prod.cuba_total_cents, v_agreed, v_track)
      returning id into v_new_id;
      perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason,
        'units.' || v_new_id::text, 'ADD', null,
        v_prod.name
          || case when v_variant_label is not null then ' / ' || v_variant_label else '' end
          || ' @ ' || v_agreed::text
          || case when v_track is not null then ' (' || v_track || ')' else '' end);
    end if;
    v_pos := v_pos + 1;
  end loop;

  select coalesce(array_agg((e->>'id')::uuid) filter (where nullif(e->>'id', '') is not null),
                  array[]::uuid[])
    into v_payload_extra_ids
    from jsonb_array_elements(v_extras_json) e;

  for v_old_extra in select * from public.sale_extras where sale_id = p_sale_id loop
    if not (v_old_extra.id = any(v_payload_extra_ids)) then
      perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason,
        'extras.' || v_old_extra.id::text, 'REMOVE',
        coalesce(nullif(v_old_extra.description, ''), 'Extra')
          || ' x' || coalesce(v_old_extra.quantity, 1)::text
          || ' @ ' || coalesce(v_old_extra.unit_price_cents, 0)::text,
        null);
      delete from public.sale_extras where id = v_old_extra.id;
    end if;
  end loop;

  v_pos := 0;
  for v_e in select * from jsonb_array_elements(v_extras_json) loop
    ne_desc  := nullif(btrim(coalesce(v_e->>'description', '')), '');
    ne_qty   := greatest(1, coalesce((v_e->>'quantity')::int, 1));
    ne_price := greatest(0, coalesce((v_e->>'unitAmountCents')::bigint, 0));

    if nullif(v_e->>'id', '') is not null
      and exists (select 1 from public.sale_extras
                  where id = (v_e->>'id')::uuid and sale_id = p_sale_id) then
      select * into v_old_extra from public.sale_extras where id = (v_e->>'id')::uuid;
      perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason,
        'extras.' || v_old_extra.id::text || '.description', 'UPDATE', v_old_extra.description, ne_desc);
      perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason,
        'extras.' || v_old_extra.id::text || '.quantity', 'UPDATE', v_old_extra.quantity::text, ne_qty::text);
      perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason,
        'extras.' || v_old_extra.id::text || '.unit_price_cents', 'UPDATE', v_old_extra.unit_price_cents::text, ne_price::text);
      update public.sale_extras set
        description = ne_desc, quantity = ne_qty, unit_price_cents = ne_price, position = v_pos
      where id = v_old_extra.id;
    else
      insert into public.sale_extras (sale_id, description, quantity, unit_price_cents, position)
      values (p_sale_id, ne_desc, ne_qty, ne_price, v_pos)
      returning id into v_new_id;
      perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason,
        'extras.' || v_new_id::text, 'ADD', null,
        coalesce(ne_desc, 'Extra') || ' x' || ne_qty::text || ' @ ' || ne_price::text);
    end if;
    v_pos := v_pos + 1;
  end loop;

  for v_d in select * from jsonb_array_elements(v_docs_json) loop
    if v_d->>'action' = 'remove' then
      delete from public.sale_documents
        where sale_id = p_sale_id
          and subject_type = v_d->>'subjectType'
          and side = v_d->>'side';
      perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason,
        'documents.' || lower(v_d->>'subjectType') || '.' || lower(v_d->>'side'),
        'REMOVE', 'documento', null);
    elsif v_d->>'action' = 'replace' then
      v_party_id := null;
      v_recipient_id := null;
      if v_d->>'subjectType' = 'BUYER' then
        select id into v_party_id from public.sale_parties
          where sale_id = p_sale_id and party_role = 'PRIMARY_BUYER';
      elsif v_d->>'subjectType' = 'CO_BUYER' then
        select id into v_party_id from public.sale_parties
          where sale_id = p_sale_id and party_role = 'CO_BUYER';
      elsif v_d->>'subjectType' = 'CUBA_RECIPIENT' then
        select id into v_recipient_id from public.sale_cuba_recipients
          where sale_id = p_sale_id;
      end if;
      insert into public.sale_documents (
        sale_id, subject_type, side, party_id, recipient_id, storage_path,
        mime_type, file_size_bytes, uploaded_by)
      values (
        p_sale_id, v_d->>'subjectType', v_d->>'side', v_party_id, v_recipient_id,
        v_d->>'storagePath', nullif(v_d->>'mimeType', ''),
        nullif(v_d->>'fileSizeBytes', '')::bigint, v_uid)
      on conflict (sale_id, subject_type, side) do update set
        party_id = excluded.party_id, recipient_id = excluded.recipient_id,
        storage_path = excluded.storage_path, mime_type = excluded.mime_type,
        file_size_bytes = excluded.file_size_bytes, uploaded_by = excluded.uploaded_by;
      perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason,
        'documents.' || lower(v_d->>'subjectType') || '.' || lower(v_d->>'side'),
        'REPLACE', 'documento anterior', 'documento actualizado');
    end if;
  end loop;

  select coalesce(sum(agreed_price_cents), 0) into v_units_total
    from public.sale_units where sale_id = p_sale_id;
  select coalesce(sum(greatest(1, quantity) * greatest(0, unit_price_cents)), 0) into v_extras_total
    from public.sale_extras where sale_id = p_sale_id;
  v_delivery_total := coalesce(v_sale.delivery_total_cents, 0);
  v_sale_total := v_units_total + v_extras_total + v_delivery_total;

  nn_notes := nullif(btrim(coalesce(p_payload->>'internalNotes', '')), '');

  perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason,
    'internal_notes', 'UPDATE', v_sale.internal_notes, nn_notes);
  perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason,
    'totals.units_total_cents', 'UPDATE', v_sale.units_total_cents::text, v_units_total::text);
  perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason,
    'totals.extras_total_cents', 'UPDATE', v_sale.extras_total_cents::text, v_extras_total::text);
  perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason,
    'totals.sale_total_cents', 'UPDATE', v_sale.sale_total_cents::text, v_sale_total::text);

  update public.sales set
    internal_notes       = nn_notes,
    units_total_cents    = v_units_total,
    extras_total_cents   = v_extras_total,
    delivery_total_cents = v_delivery_total,
    sale_total_cents     = v_sale_total,
    updated_at           = now()
  where id = p_sale_id;
  -- status / sale_number / seller_id / sold_at / sold_by / paid_at / paid_by /
  -- tracking_code de unidades sin cambios: INTACTOS.

  select count(*) into v_change_count
    from public.sale_change_history where edit_group = v_group;

  return jsonb_build_object(
    'ok', true,
    'saleId', p_sale_id,
    'saleNumber', v_sale.sale_number,
    'status', v_sale.status,
    'unitsTotalCents', v_units_total,
    'extrasTotalCents', v_extras_total,
    'deliveryTotalCents', v_delivery_total,
    'saleTotalCents', v_sale_total,
    'changeCount', v_change_count,
    'editGroup', v_group);
end;
$$;
revoke all on function public.update_confirmed_cuba_sale(uuid, jsonb, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. Solicitud de edición del vendedor: rechazo inmediato bajo el mínimo.
-- ---------------------------------------------------------------------------
create or replace function public.request_sale_edit(p_sale_id uuid, p_reason text, p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_sale   public.sales;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_snapshot jsonb;
  v_flat     jsonb;
  v_entry    jsonb;
  v_path     text;
  v_id_part  text;
  v_field    text;
  v_id       uuid;
  v_current  text;
  v_request_id uuid;
  v_min_price bigint;
  v_min_commission bigint;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not exists (select 1 from public.profiles where id = v_uid and is_active) then
    return jsonb_build_object('ok', false, 'code', 'PROFILE_INACTIVE');
  end if;
  if length(v_reason) < 4 then
    return jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
  end if;
  if jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) = 0 then
    return jsonb_build_object('ok', false, 'code', 'NO_CHANGES');
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
  if v_sale.status = 'PAID' then
    return jsonb_build_object('ok', false, 'code', 'SALE_PAID_REQUIRES_ADMIN_CORRECTION');
  end if;
  if v_sale.status not in ('PENDING', 'SOLD') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATUS');
  end if;
  if exists (select 1 from public.sale_edit_requests where sale_id = p_sale_id and status = 'PENDING') then
    return jsonb_build_object('ok', false, 'code', 'REQUEST_ALREADY_PENDING');
  end if;

  v_snapshot := public.sale_edit_snapshot(p_sale_id);
  v_flat := v_snapshot->'flat';

  for v_entry in select * from jsonb_array_elements(p_changes) loop
    v_path := v_entry->>'path';
    if v_path is null or v_path = '' then
      return jsonb_build_object('ok', false, 'code', 'INVALID_CHANGE_PATH');
    end if;

    if v_path in (
      'buyer.first_name', 'buyer.last_name', 'buyer.phone', 'buyer.email',
      'buyer.address_line1', 'buyer.address_line2', 'buyer.city', 'buyer.state',
      'buyer.postal_code', 'buyer.document_number',
      'recipient.full_name', 'recipient.identity_number', 'recipient.delivery_address',
      'recipient.municipality', 'recipient.province', 'recipient.primary_phone', 'recipient.secondary_phone',
      'delivery.method', 'delivery.pickup_reference', 'internal_notes'
    ) then
      null;
    elsif v_path like 'units.%' then
      v_id_part := split_part(v_path, '.', 2);
      v_field := split_part(v_path, '.', 3);
      if v_field not in ('variant_id', 'agreed_price_cents') then
        return jsonb_build_object('ok', false, 'code', 'INVALID_CHANGE_PATH', 'path', v_path);
      end if;
      begin
        v_id := v_id_part::uuid;
      exception when others then
        return jsonb_build_object('ok', false, 'code', 'INVALID_CHANGE_PATH', 'path', v_path);
      end;
      if not exists (select 1 from public.sale_units where id = v_id and sale_id = p_sale_id) then
        return jsonb_build_object('ok', false, 'code', 'UNIT_NOT_IN_SALE', 'path', v_path);
      end if;
      -- Nuevo precio: nunca por debajo del precio fijo (el CONGELADO si la
      -- unidad ya tiene comisión; si no, el vigente del producto).
      if v_field = 'agreed_price_cents' then
        if coalesce(v_entry->>'newValue', '') !~ '^[0-9]+$' or (v_entry->>'newValue')::bigint <= 0 then
          return jsonb_build_object('ok', false, 'code', 'UNIT_AGREED_PRICE_INVALID', 'path', v_path);
        end if;
        v_min_price := null;
        v_min_commission := null;
        select sc.reference_price_cents into v_min_price
          from public.sale_commissions sc where sc.sale_unit_id = v_id;
        if v_min_price is null then
          select p.default_reference_price_cents, p.default_base_commission_cents
            into v_min_price, v_min_commission
            from public.sale_units su join public.products p on p.id = su.product_id
            where su.id = v_id;
          if not public._product_pricing_configured(v_min_price, v_min_commission) then
            return jsonb_build_object('ok', false, 'code', 'UNIT_COMMISSION_CONFIG_MISSING', 'path', v_path);
          end if;
        end if;
        if (v_entry->>'newValue')::bigint < v_min_price then
          return jsonb_build_object('ok', false, 'code', 'UNIT_PRICE_BELOW_FIXED_PRICE', 'path', v_path,
            'fixedPriceCents', v_min_price);
        end if;
      end if;
    elsif v_path like 'extras.%' then
      v_id_part := split_part(v_path, '.', 2);
      v_field := split_part(v_path, '.', 3);
      if v_field not in ('description', 'quantity', 'unit_price_cents') then
        return jsonb_build_object('ok', false, 'code', 'INVALID_CHANGE_PATH', 'path', v_path);
      end if;
      begin
        v_id := v_id_part::uuid;
      exception when others then
        return jsonb_build_object('ok', false, 'code', 'INVALID_CHANGE_PATH', 'path', v_path);
      end;
      if not exists (select 1 from public.sale_extras where id = v_id and sale_id = p_sale_id) then
        return jsonb_build_object('ok', false, 'code', 'EXTRA_NOT_IN_SALE', 'path', v_path);
      end if;
    else
      return jsonb_build_object('ok', false, 'code', 'INVALID_CHANGE_PATH', 'path', v_path);
    end if;

    v_current := v_flat->>v_path;
    if coalesce(v_entry->>'oldValue', '') is distinct from coalesce(v_current, '') then
      return jsonb_build_object('ok', false, 'code', 'REQUEST_CONFLICT', 'path', v_path,
        'currentValue', v_current, 'declaredOldValue', v_entry->>'oldValue');
    end if;
  end loop;

  insert into public.sale_edit_requests (sale_id, requested_by, reason, requested_changes, sale_status_at_request)
  values (p_sale_id, v_uid, v_reason, p_changes, v_sale.status)
  returning id into v_request_id;

  return jsonb_build_object('ok', true, 'requestId', v_request_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Alertas: texto con la nueva terminología.
-- ---------------------------------------------------------------------------
create or replace function public.admin_alerts_list(
  p_category text default 'ALL', p_priority text default 'ALL', p_seller_id uuid default null,
  p_limit int default 50, p_offset int default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_category text := coalesce(nullif(upper(btrim(p_category)), ''), 'ALL');
  v_priority text := coalesce(nullif(upper(btrim(p_priority)), ''), 'ALL');
  v_limit    int  := greatest(1, least(coalesce(p_limit, 50), 100));
  v_offset   int  := greatest(0, coalesce(p_offset, 0));
  v_result   jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  with merged as (
    -- APROBACIONES · edición pendiente
    select
      'APROBACIONES'::text as category, 'EDICION_PENDIENTE'::text as type, 'MEDIUM'::text as priority,
      r.created_at as age_at,
      'EDICIÓN PENDIENTE'::text as title,
      'Solicitud de edición · ' || coalesce(s.sale_number, 'sin número') as detail,
      s.seller_id, pr.full_name as seller_name,
      'sale_edit_request'::text as entity_type, r.id as entity_id, s.id as sale_id,
      null::bigint as amount_cents,
      '/admin/aprobaciones/ediciones/' || r.id::text as action_url, 'REVISAR'::text as action_label
    from public.sale_edit_requests r
    join public.sales s on s.id = r.sale_id
    join public.profiles pr on pr.id = s.seller_id
    where r.status = 'PENDING'

    union all

    -- CONTRATOS · requieren acción
    select
      'CONTRATOS', 'CONTRATO_' || c.contract_status, 'MEDIUM',
      c.last_update,
      'CONTRATO · ' || c.provider_name,
      coalesce(c.sale_number, 'sin número') || ' · ' ||
        case c.contract_status
          when 'NOT_SENT' then 'sin enviar'
          when 'SENT' then 'esperando firma'
          when 'SIGNED' then 'esperando acreditación'
          else c.contract_status
        end,
      c.seller_id, c.seller_name,
      'financing_contract', coalesce(c.contract_id, c.allocation_id), c.sale_id,
      c.net_cents,
      '/admin/ventas/' || c.sale_id::text, 'VER VENTA'
    from public.admin_actionable_financing_contracts() c

    union all

    -- COBROS · pendiente a cobrar
    select
      'COBROS', 'PENDIENTE_A_COBRAR', 'MEDIUM',
      coalesce(x.sold_at, now()),
      'PENDIENTE A COBRAR',
      coalesce(x.sale_number, 'sin número') || ' · cobro parcial',
      x.seller_id, x.seller_name,
      'sale', x.sale_id, x.sale_id,
      x.outstanding_cents,
      '/admin/ventas/' || x.sale_id::text, 'VER COBRO'
    from public.admin_sold_sales_settlement() x
    where x.outstanding_cents > 0

    union all

    -- PAGOS · lista para marcar pagada
    select
      'PAGOS', 'LISTA_PARA_PAGAR', 'HIGH',
      coalesce(x.sold_at, now()),
      'LISTA PARA MARCAR PAGADA',
      coalesce(x.sale_number, 'sin número') || ' · cobro completo',
      x.seller_id, x.seller_name,
      'sale', x.sale_id, x.sale_id,
      x.sale_total_cents,
      '/admin/ventas/' || x.sale_id::text, 'VER VENTA'
    from public.admin_sold_sales_settlement() x
    where x.ready_for_paid

    union all

    -- COMISIONES · configuración faltante
    select
      'COMISIONES', 'CONFIG_COMISION_FALTANTE', 'HIGH',
      now(),
      'CONFIGURACIÓN DE COMISIÓN FALTANTE',
      'Producto activo sin precio fijo de venta o comisión fija · ' || cm.product_name,
      null::uuid, null::text,
      'product', cm.entity_id, null::uuid,
      null::bigint,
      '/admin/productos/' || cm.entity_id::text,
      'CONFIGURAR COMISIÓN'
    from public._commission_config_missing_rows() cm

    union all

    -- LIQUIDACIONES · pendiente de crear / aprobar / pagar (nunca la semana en curso)
    select
      'LIQUIDACIONES',
      case when la.liquidation_id is null then 'LIQUIDACION_PENDIENTE_CREAR'
           when la.liquidation_status = 'DRAFT' then 'LIQUIDACION_PENDIENTE_APROBAR'
           else 'LIQUIDACION_PENDIENTE_PAGO' end,
      case when la.liquidation_id is not null and la.liquidation_status = 'APPROVED' then 'HIGH' else 'MEDIUM' end,
      public._liquidation_week_close_at(la.week_start),
      case when la.liquidation_id is null then 'LIQUIDACIÓN PENDIENTE DE CREAR'
           when la.liquidation_status = 'DRAFT' then 'LIQUIDACIÓN PENDIENTE DE APROBAR'
           else 'LIQUIDACIÓN APROBADA — PENDIENTE DE PAGO' end,
      la.seller_name || ' · semana ' || la.week_start || ' – ' || la.week_end,
      la.seller_id, la.seller_name,
      'weekly_liquidation', coalesce(la.liquidation_id, la.seller_id), null::uuid,
      la.amount_cents,
      coalesce('/admin/liquidaciones/' || la.liquidation_id::text, '/admin/liquidaciones?week=' || la.week_start::text),
      case when la.liquidation_id is null then 'CREAR LIQUIDACIÓN' else 'VER LIQUIDACIÓN' end
    from public._liquidation_alert_rows() la

    union all

    -- VENDEDORES · invitación pendiente
    select
      'VENDEDORES', 'INVITACION_PENDIENTE', 'LOW',
      i.invited_at,
      'INVITACIÓN PENDIENTE',
      i.email,
      null::uuid, null::text,
      'seller_invitation', i.id, null::uuid,
      null::bigint,
      '/admin/vendedores', 'VER VENDEDORES'
    from public.seller_invitations i
    where i.status = 'PENDING'

    union all

    -- LOGISTICA · vendida/pagada pero sin empezar a preparar
    select
      'LOGISTICA', 'LOGISTICA_PENDIENTE_PREPARAR', 'MEDIUM',
      l.last_event_at,
      'PENDIENTE DE PREPARAR',
      coalesce(s.sale_number, 'sin número') || ' · ' || su.product_name_snapshot,
      s.seller_id, pr.full_name,
      'sale_unit'::text, su.id, s.id,
      null::bigint,
      '/admin/ventas/' || s.id::text, 'VER VENTA'
    from public.sale_unit_logistics l
    join public.sale_units su on su.id = l.sale_unit_id
    join public.sales s on s.id = su.sale_id
    join public.profiles pr on pr.id = s.seller_id
    where l.status = 'PENDING_PREPARATION' and s.operation_type = 'CUBA' and s.status in ('SOLD', 'PAID')

    union all

    -- LOGISTICA · en espera (motivo obligatorio ya validado al entrar aquí)
    select
      'LOGISTICA', 'LOGISTICA_EN_ESPERA', 'HIGH',
      l.last_event_at,
      'EN ESPERA',
      coalesce(s.sale_number, 'sin número') || ' · ' || su.product_name_snapshot || ' · ' || coalesce(l.hold_reason, 'sin motivo'),
      s.seller_id, pr.full_name,
      'sale_unit'::text, su.id, s.id,
      null::bigint,
      '/admin/ventas/' || s.id::text, 'VER VENTA'
    from public.sale_unit_logistics l
    join public.sale_units su on su.id = l.sale_unit_id
    join public.sales s on s.id = su.sale_id
    join public.profiles pr on pr.id = s.seller_id
    where l.status = 'ON_HOLD'

    union all

    -- LOGISTICA · lista para entrega
    select
      'LOGISTICA', 'LOGISTICA_LISTA_ENTREGA', 'MEDIUM',
      l.last_event_at,
      'LISTA PARA ENTREGA',
      coalesce(s.sale_number, 'sin número') || ' · ' || su.product_name_snapshot,
      s.seller_id, pr.full_name,
      'sale_unit'::text, su.id, s.id,
      null::bigint,
      '/admin/ventas/' || s.id::text, 'CONFIRMAR ENTREGA'
    from public.sale_unit_logistics l
    join public.sale_units su on su.id = l.sale_unit_id
    join public.sales s on s.id = su.sale_id
    join public.profiles pr on pr.id = s.seller_id
    where l.status = 'READY_FOR_DELIVERY'
  ),
  filtered as (
    select * from merged m
    where (v_category = 'ALL' or m.category = v_category)
      and (v_priority = 'ALL' or m.priority = v_priority)
      and (p_seller_id is null or m.seller_id = p_seller_id)
  ),
  paged as (
    select * from filtered order by priority = 'HIGH' desc, priority = 'MEDIUM' desc, age_at desc
    limit v_limit offset v_offset
  ),
  total as (
    select count(*) as n from filtered
  )
  select jsonb_build_object(
    'ok', true,
    'total', (select n from total),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'category', p.category, 'type', p.type, 'priority', p.priority, 'occurredAt', p.age_at,
        'title', p.title, 'detail', p.detail,
        'sellerId', p.seller_id, 'sellerName', p.seller_name,
        'entityType', p.entity_type, 'entityId', p.entity_id, 'saleId', p.sale_id,
        'amountCents', p.amount_cents, 'actionUrl', p.action_url, 'actionLabel', p.action_label
      ) order by p.priority = 'HIGH' desc, p.priority = 'MEDIUM' desc, p.age_at desc)
      from paged p
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;
