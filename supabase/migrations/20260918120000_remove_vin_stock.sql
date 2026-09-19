-- ===========================================================================
-- SMILE MOTORS · SIN VIN NI STOCK FÍSICO (simplificación enfocada).
--
-- La aplicación deja de gestionar cantidad física de stock y números VIN.
-- NADA se borra: `inventory_units`, `inventory_unit_events`,
-- `sale_units.inventory_unit_id`, `product_variants.quantity_reported`,
-- `products.stock_mode`, la config de comisión por VIN y las funciones
-- `admin_*inventory*` / `sale_unit_inventory_status` /
-- `_inventory_reconciliation_rows` quedan como infraestructura LEGADA e
-- INACTIVA (sin dependencia en tiempo de ejecución). Una limpieza física
-- futura, separada, podrá eliminarlas.
--
-- Cambios (cada función se redefine a partir de su versión VIGENTE, con
-- cambios mínimos):
--   * mark_sale_sold: sin requisito ni transición de inventario; la comisión
--     NUEVA siempre sale del PRODUCTO (misma fórmula). Resto de validaciones
--     intactas (dueño/admin, PENDING, contratos firmados, datos, config).
--   * update_confirmed_cuba_sale / admin_update_cuba_sale / request_sale_edit:
--     sin bloqueos por VIN (UNIT_INVENTORY_LOCKED). Producto/variante siguen
--     validados; comisión snapshot intacta.
--   * Alertas: sin discrepancia de inventario; "comisión faltante" = producto
--     ACTIVO sin precio de referencia o comisión base → /admin/productos/[id].
--   * Actividad: sin eventos de inventario (las filas históricas se conservan).
--   * Búsqueda global: sin VIN; + financiera.
--   * Productos / Reportes / Logística / KPI de comisiones: sin stock ni VIN.
-- Las comisiones históricas (source_type = INVENTORY_UNIT) NO se tocan.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Documentación de lo que queda LEGADO / INACTIVO.
-- ---------------------------------------------------------------------------
comment on table public.inventory_units is
  'LEGADO/INACTIVO desde 20260918: la app ya no gestiona VIN ni stock físico. Se conserva por historial; ninguna función activa la lee ni escribe.';
comment on table public.inventory_unit_events is
  'LEGADO/INACTIVO desde 20260918: historial de VIN conservado; fuera de Actividad.';
comment on column public.sale_units.inventory_unit_id is
  'LEGADO/INACTIVO desde 20260918: ya no se asigna VIN a unidades de venta. Se conserva por compatibilidad histórica.';
comment on column public.product_variants.quantity_reported is
  'LEGADO/INACTIVO desde 20260918: el catálogo ya no representa cantidad física. No se edita ni se muestra.';
comment on column public.products.stock_mode is
  'LEGADO/INACTIVO desde 20260918: sin distinción stock/bajo pedido; la comisión siempre se configura por producto.';

-- ---------------------------------------------------------------------------
-- 2. Comisión faltante: solo productos ACTIVOS sin config (sin VIN).
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
    and (p.default_reference_price_cents is null or p.default_base_commission_cents is null);
$$;
revoke all on function public._commission_config_missing_rows() from public, anon, authenticated;

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
    'missingConfigCount', (select count(*) from public._commission_config_missing_rows())
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Cierre comercial y edición — sin VIN.
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

  -- Comisión: cada unidad debe tener configuración RESOLUBLE antes de mutar
  -- nada — SIEMPRE la del PRODUCTO (precio de referencia + comisión base).
  -- Sin VIN ni unidad física. Nunca se inventa $0.
  for v_cu in
    select su.id as sale_unit_id,
      p.default_reference_price_cents as p_ref, p.default_base_commission_cents as p_base
    from public.sale_units su
    join public.products p on p.id = su.product_id
    where su.sale_id = p_sale_id
  loop
    if v_cu.p_ref is null or v_cu.p_base is null then
      v_commission_missing := array_append(v_commission_missing, v_cu.sale_unit_id::text);
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

  insert into public.sale_status_history (sale_id, from_status, to_status, changed_by, reason)
  values (p_sale_id, 'PENDING', 'SOLD', v_uid,
    case when v_sale.seller_id <> v_uid then 'Marcada como vendida por administración' end);

  return jsonb_build_object('ok', true, 'saleId', p_sale_id, 'saleNumber', v_number,
    'status', 'SOLD', 'saleTotalCents', v_sale_total);
end;
$$;

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

create or replace function public.admin_update_cuba_sale(
  p_sale_id uuid,
  p_payload jsonb,
  p_reason text,
  p_admin_correction boolean default false,
  p_expected_updated_at timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_sale    public.sales;
  v_reason  text := btrim(coalesce(p_reason, ''));
  v_snap    jsonb;
  v_base    jsonb;
  v_payload jsonb;
  v_units   jsonb;
  v_extras  jsonb;
  v_u       jsonb;
  v_e       jsonb;
  v_old_unit  public.sale_units;
  v_old_extra public.sale_extras;
  v_comm      public.sale_commissions;
  v_ids       uuid[];
  v_fin_blocked text[] := array[]::text[];
  v_structure   text[] := array[]::text[];
  v_comm_locked text[] := array[]::text[];
  v_prod_locked text[] := array[]::text[];
  v_price_changed uuid[] := array[]::uuid[];
  v_result  jsonb;
  v_id      uuid;
  v_new_price bigint;
  v_new_diff  bigint;
  v_new_share bigint;
  v_new_final bigint;
  v_comm_adjusted int := 0;
  v_alloc_net bigint;
  v_collected bigint;
  v_new_total bigint;
  v_kind text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_PAYLOAD');
  end if;

  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'SALE_NOT_FOUND');
  end if;
  if v_sale.operation_type <> 'CUBA' then
    return jsonb_build_object('ok', false, 'code', 'NOT_CUBA');
  end if;
  if v_sale.status not in ('DRAFT', 'PENDING', 'SOLD', 'PAID') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATUS');
  end if;
  if v_sale.status = 'PAID' and not coalesce(p_admin_correction, false) then
    return jsonb_build_object('ok', false, 'code', 'PAID_REQUIRES_ADMIN_CORRECTION');
  end if;
  if p_expected_updated_at is not null and v_sale.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('ok', false, 'code', 'SALE_CHANGED');
  end if;

  if v_sale.status = 'DRAFT' and length(v_reason) < 4 then
    v_reason := 'Edición administrativa de borrador';
  end if;
  if length(v_reason) < 4 then
    return jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
  end if;

  -- Payload completo = snapshot ACTUAL + lo que envía el admin (lo omitido
  -- conserva su valor; nunca se borra un dato por no venir en el payload).
  v_snap := public.sale_edit_snapshot(p_sale_id);
  v_base := v_snap->'payload';
  v_payload := v_base;
  if jsonb_typeof(p_payload->'buyer') = 'object' then
    v_payload := jsonb_set(v_payload, '{buyer}', coalesce(v_base->'buyer', '{}'::jsonb) || (p_payload->'buyer'));
  end if;
  if p_payload ? 'coBuyer' then
    if jsonb_typeof(p_payload->'coBuyer') = 'object' then
      v_payload := jsonb_set(v_payload, '{coBuyer}',
        case when jsonb_typeof(v_base->'coBuyer') = 'object' then v_base->'coBuyer' else '{}'::jsonb end || (p_payload->'coBuyer'));
    else
      v_payload := jsonb_set(v_payload, '{coBuyer}', 'null'::jsonb);
    end if;
  end if;
  if jsonb_typeof(p_payload->'cubaRecipient') = 'object' then
    v_payload := jsonb_set(v_payload, '{cubaRecipient}', coalesce(v_base->'cubaRecipient', '{}'::jsonb) || (p_payload->'cubaRecipient'));
  end if;
  if jsonb_typeof(p_payload->'delivery') = 'object' then
    v_payload := jsonb_set(v_payload, '{delivery}', coalesce(v_base->'delivery', '{}'::jsonb) || (p_payload->'delivery'));
  end if;
  if jsonb_typeof(p_payload->'units') = 'array' then
    v_payload := jsonb_set(v_payload, '{units}', p_payload->'units');
  end if;
  if jsonb_typeof(p_payload->'extras') = 'array' then
    v_payload := jsonb_set(v_payload, '{extras}', p_payload->'extras');
  end if;
  if p_payload ? 'internalNotes' then
    v_payload := jsonb_set(v_payload, '{internalNotes}', coalesce(p_payload->'internalNotes', '""'::jsonb));
  end if;
  -- Documentos: el editor administrativo no reemplaza documentos.
  v_payload := jsonb_set(v_payload, '{documents}', '[]'::jsonb);

  v_units := v_payload->'units';
  v_extras := v_payload->'extras';

  -- ---------------------------------------------------------------- guards
  select coalesce(array_agg((u->>'id')::uuid) filter (where nullif(u->>'id', '') is not null), array[]::uuid[])
    into v_ids from jsonb_array_elements(v_units) u;

  -- Unidades eliminadas.
  for v_old_unit in select * from public.sale_units where sale_id = p_sale_id loop
    if not (v_old_unit.id = any(v_ids)) then
      if v_sale.status in ('SOLD', 'PAID') then
        v_structure := array_append(v_structure, v_old_unit.id::text);
      end if;
      if v_sale.status = 'PAID' then
        v_fin_blocked := array_append(v_fin_blocked, 'units.' || v_old_unit.id::text || ' (baja)');
      end if;
    end if;
  end loop;

  for v_u in select * from jsonb_array_elements(v_units) loop
    if nullif(v_u->>'id', '') is null then
      -- Unidad nueva.
      if v_sale.status in ('SOLD', 'PAID') then
        v_structure := array_append(v_structure, 'new');
      end if;
      if v_sale.status = 'PAID' then
        v_fin_blocked := array_append(v_fin_blocked, 'units (alta)');
      end if;
      continue;
    end if;
    select * into v_old_unit from public.sale_units where id = (v_u->>'id')::uuid and sale_id = p_sale_id;
    if not found then
      continue; -- el motor devuelve UNIT_ID_UNKNOWN
    end if;

    -- Producto con comisión ya snapshoteada (SOLD/PAID).
    if v_old_unit.product_id is distinct from nullif(v_u->>'productId', '')::uuid
       and exists (select 1 from public.sale_commissions sc where sc.sale_unit_id = v_old_unit.id) then
      v_prod_locked := array_append(v_prod_locked, v_old_unit.id::text);
    end if;

    if v_old_unit.agreed_price_cents is distinct from coalesce((v_u->>'agreedPriceCents')::bigint, 0) then
      v_price_changed := array_append(v_price_changed, v_old_unit.id);
      if v_sale.status = 'PAID' then
        v_fin_blocked := array_append(v_fin_blocked, 'units.' || v_old_unit.id::text || '.agreed_price_cents');
      end if;
      select * into v_comm from public.sale_commissions where sale_unit_id = v_old_unit.id;
      if found and (v_comm.status <> 'PENDING' or v_comm.liquidation_id is not null) then
        v_comm_locked := array_append(v_comm_locked, v_old_unit.id::text);
      end if;
    end if;
    if v_sale.status = 'PAID' and v_old_unit.product_id is distinct from nullif(v_u->>'productId', '')::uuid then
      v_fin_blocked := array_append(v_fin_blocked, 'units.' || v_old_unit.id::text || '.product');
    end if;
  end loop;

  -- Extras en una venta PAGADA: solo la descripción es editable.
  if v_sale.status = 'PAID' then
    select coalesce(array_agg((e->>'id')::uuid) filter (where nullif(e->>'id', '') is not null), array[]::uuid[])
      into v_ids from jsonb_array_elements(v_extras) e;
    for v_old_extra in select * from public.sale_extras where sale_id = p_sale_id loop
      if not (v_old_extra.id = any(v_ids)) then
        v_fin_blocked := array_append(v_fin_blocked, 'extras.' || v_old_extra.id::text || ' (baja)');
      end if;
    end loop;
    for v_e in select * from jsonb_array_elements(v_extras) loop
      if nullif(v_e->>'id', '') is null then
        v_fin_blocked := array_append(v_fin_blocked, 'extras (alta)');
        continue;
      end if;
      select * into v_old_extra from public.sale_extras where id = (v_e->>'id')::uuid and sale_id = p_sale_id;
      if found and (
           v_old_extra.quantity is distinct from greatest(1, coalesce((v_e->>'quantity')::int, 1))
        or v_old_extra.unit_price_cents is distinct from greatest(0, coalesce((v_e->>'unitAmountCents')::bigint, 0))) then
        v_fin_blocked := array_append(v_fin_blocked, 'extras.' || v_old_extra.id::text);
      end if;
    end loop;
  end if;

  if array_length(v_fin_blocked, 1) is not null then
    return jsonb_build_object('ok', false, 'code', 'PAID_FINANCIAL_CHANGE_BLOCKED', 'fields', to_jsonb(v_fin_blocked));
  end if;
  if array_length(v_structure, 1) is not null then
    return jsonb_build_object('ok', false, 'code', 'UNIT_STRUCTURE_LOCKED');
  end if;
  if array_length(v_prod_locked, 1) is not null then
    return jsonb_build_object('ok', false, 'code', 'UNIT_PRODUCT_LOCKED_COMMISSION', 'saleUnitIds', to_jsonb(v_prod_locked));
  end if;
  if array_length(v_comm_locked, 1) is not null then
    return jsonb_build_object('ok', false, 'code', 'COMMISSION_LOCKED', 'saleUnitIds', to_jsonb(v_comm_locked));
  end if;

  -- ------------------------------------------------ aplicar (motor único)
  v_kind := case when v_sale.status = 'PAID' then 'ADMIN_CORRECTION' else 'ADMIN_EDIT' end;
  perform set_config('motods.acting_as_seller', v_sale.seller_id::text, true);
  perform set_config('motods.admin_direct_edit', 'on', true);
  perform set_config('motods.edit_kind', v_kind, true);
  perform set_config('motods.edit_request_id', '', true);
  perform set_config('motods.edit_requested_by', '', true);

  v_result := public.update_confirmed_cuba_sale(p_sale_id, v_payload, v_reason);

  perform set_config('motods.acting_as_seller', '', true);
  perform set_config('motods.admin_direct_edit', '', true);
  perform set_config('motods.edit_kind', '', true);

  if not coalesce((v_result->>'ok')::boolean, false) then
    return v_result;
  end if;

  -- ------------------------------------ comisión (SOLD): snapshot, nunca config viva
  if v_sale.status = 'SOLD' and array_length(v_price_changed, 1) is not null then
    foreach v_id in array v_price_changed loop
      select * into v_comm from public.sale_commissions where sale_unit_id = v_id for update;
      if found and v_comm.status = 'PENDING' and v_comm.liquidation_id is null then
        select agreed_price_cents into v_new_price from public.sale_units where id = v_id;
        v_new_diff := v_new_price - v_comm.reference_price_cents;
        v_new_share := v_new_diff / 2;  -- misma fórmula (trunca hacia cero)
        v_new_final := greatest(0, v_comm.base_commission_cents + v_new_share);
        update public.sale_commissions set
          sale_price_cents = v_new_price,
          price_difference_cents = v_new_diff,
          seller_difference_share_cents = v_new_share,
          final_commission_cents = v_new_final
        where id = v_comm.id;
        insert into public.commission_events (commission_id, sale_id, sale_unit_id, event_type, actor_id, before, after, reason)
        values (v_comm.id, v_comm.sale_id, v_comm.sale_unit_id, 'COMMISSION_ADJUSTED_BY_ADMIN_EDIT', v_uid,
          jsonb_build_object('salePriceCents', v_comm.sale_price_cents, 'differenceCents', v_comm.price_difference_cents,
            'sellerShareCents', v_comm.seller_difference_share_cents, 'finalCommissionCents', v_comm.final_commission_cents),
          jsonb_build_object('salePriceCents', v_new_price, 'differenceCents', v_new_diff,
            'sellerShareCents', v_new_share, 'finalCommissionCents', v_new_final),
          'Edición administrativa: ' || v_reason);
        v_comm_adjusted := v_comm_adjusted + 1;
      end if;
    end loop;
  end if;

  -- ------------------------------------------- señal de conciliación (derivada)
  select coalesce(sum(net_amount_cents), 0) into v_alloc_net
    from public.sale_payment_allocations where sale_id = p_sale_id;
  select collected_cents into v_collected from public.sale_settlement_amounts(p_sale_id);
  v_new_total := coalesce((v_result->>'saleTotalCents')::bigint, 0);

  return v_result || jsonb_build_object(
    'editKind', v_kind,
    'commissionsAdjusted', v_comm_adjusted,
    'reconciliation', jsonb_build_object(
      'required', v_sale.status in ('PENDING', 'SOLD', 'PAID')
                  and (v_alloc_net <> v_new_total or (v_sale.status in ('SOLD', 'PAID') and coalesce(v_collected, 0) > v_new_total)),
      'saleTotalCents', v_new_total,
      'allocatedNetCents', v_alloc_net,
      'collectedCents', coalesce(v_collected, 0),
      'differenceCents', v_alloc_net - v_new_total));
end;
$$;

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
-- 4. Alertas / Actividad / Búsqueda.
-- ---------------------------------------------------------------------------
create or replace function public.admin_alerts_summary()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_ediciones  int;
  v_contratos  int;
  v_cobros     int;
  v_pagos      int;
  v_comisiones int;
  v_liquid_crear   int;
  v_liquid_aprobar int;
  v_liquid_pagar   int;
  v_vendedores int;
  v_log_preparar int;
  v_log_espera   int;
  v_log_entrega  int;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  select count(*) into v_ediciones  from public.sale_edit_requests where status = 'PENDING';
  select count(*) into v_contratos  from public.admin_actionable_financing_contracts();
  select count(*) into v_cobros     from public.admin_sold_sales_settlement() where outstanding_cents > 0;
  select count(*) into v_pagos      from public.admin_sold_sales_settlement() where ready_for_paid;
  select count(*) into v_comisiones from public._commission_config_missing_rows();
  select count(*) into v_liquid_crear   from public._liquidation_alert_rows() where liquidation_id is null;
  select count(*) into v_liquid_aprobar from public._liquidation_alert_rows() where liquidation_status = 'DRAFT';
  select count(*) into v_liquid_pagar   from public._liquidation_alert_rows() where liquidation_status = 'APPROVED';
  select count(*) into v_vendedores from public.seller_invitations where status = 'PENDING';

  select count(*) into v_log_preparar
    from public.sale_unit_logistics l join public.sale_units su on su.id = l.sale_unit_id join public.sales s on s.id = su.sale_id
    where l.status = 'PENDING_PREPARATION' and s.operation_type = 'CUBA' and s.status in ('SOLD', 'PAID');
  select count(*) into v_log_espera from public.sale_unit_logistics where status = 'ON_HOLD';
  select count(*) into v_log_entrega from public.sale_unit_logistics where status = 'READY_FOR_DELIVERY';

  return jsonb_build_object(
    'ok', true,
    'total', v_ediciones + v_contratos + v_cobros + v_pagos + v_comisiones
             + v_liquid_crear + v_liquid_aprobar + v_liquid_pagar + v_vendedores
             + v_log_preparar + v_log_espera + v_log_entrega,
    'categories', jsonb_build_object(
      'APROBACIONES', v_ediciones,
      'CONTRATOS', v_contratos,
      'COBROS', v_cobros,
      'PAGOS', v_pagos,
      'COMISIONES', v_comisiones,
      'LIQUIDACIONES', v_liquid_crear + v_liquid_aprobar + v_liquid_pagar,
      'VENDEDORES', v_vendedores,
      'LOGISTICA', v_log_preparar + v_log_espera + v_log_entrega
    ),
    'includesApprovalCenter', jsonb_build_object(
      'edicionesSolicitadas', v_ediciones,
      'contratosRequierenAccion', v_contratos,
      'pendientesACobrar', v_cobros,
      'listasParaPagar', v_pagos
    )
  );
end;
$$;

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
      'Producto activo sin precio de referencia o comisión base · ' || cm.product_name,
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

create or replace function public.admin_activity_feed(
  p_category   text default 'ALL',
  p_actor_id   uuid default null,
  p_seller_id  uuid default null,
  p_start_date date default null,
  p_end_date   date default null,
  p_search     text default null,
  p_limit      int default 50,
  p_offset     int default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_category text := coalesce(nullif(upper(btrim(p_category)), ''), 'ALL');
  v_search   text := nullif(btrim(coalesce(p_search, '')), '');
  v_start_at timestamptz := case when p_start_date is null then null else public._dealer_day_start_at(p_start_date) end;
  v_end_at   timestamptz := case when p_end_date is null then null else public._dealer_day_start_at(p_end_date + 1) end;
  v_limit    int := greatest(1, least(coalesce(p_limit, 50), 100));
  v_offset   int := greatest(0, coalesce(p_offset, 0));
  v_result   jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  with merged as (
    select
      'VENTAS'::text as category, h.event_type as event_type, h.created_at as occurred_at,
      h.actor_id, h.actor_name, h.actor_role,
      'sale'::text as entity_type, h.sale_id as entity_id, h.sale_id, s.seller_id,
      h.title, h.description, h.metadata, ('/admin/ventas/' || h.sale_id::text) as destination_url,
      h.search_text
    from (
      select
        hs.sale_id, 'SALE_' || hs.to_status as event_type, hs.created_at,
        hs.changed_by as actor_id, pr.full_name as actor_name, pr.role as actor_role,
        case hs.to_status
          when 'PENDING'   then 'Solicitó revisión de la venta ' || coalesce(sl.sale_number, 'sin número')
          when 'SOLD'      then 'Marcó la venta ' || coalesce(sl.sale_number, 'sin número') || ' como VENDIDA'
          when 'PAID'      then 'Marcó la venta ' || coalesce(sl.sale_number, 'sin número') || ' como PAGADA'
          when 'DRAFT'     then 'Devolvió la venta ' || coalesce(sl.sale_number, 'sin número') || ' a borrador'
          when 'CANCELLED' then 'Canceló la venta ' || coalesce(sl.sale_number, 'sin número')
          else 'Cambió el estado de la venta ' || coalesce(sl.sale_number, 'sin número')
        end as title,
        hs.reason as description,
        jsonb_build_object('fromStatus', hs.from_status, 'toStatus', hs.to_status) as metadata,
        coalesce(sl.sale_number, '') || ' ' || coalesce(pr2.full_name, '') as search_text
      from public.sale_status_history hs
      join public.sales sl on sl.id = hs.sale_id
      left join public.profiles pr on pr.id = hs.changed_by
      left join public.profiles pr2 on pr2.id = sl.seller_id
      where sl.operation_type = 'CUBA' and hs.from_status is not null
    ) h
    join public.sales s on s.id = h.sale_id

    union all

    select
      'VENTAS', 'EDIT_REQUESTED', r.created_at,
      r.requested_by, pr.full_name, pr.role,
      'sale_edit_request', r.id, r.sale_id, s.seller_id,
      'Solicitó editar la venta ' || coalesce(s.sale_number, 'sin número'),
      r.reason, jsonb_build_object('status', r.status),
      '/admin/aprobaciones/ediciones/' || r.id::text,
      coalesce(s.sale_number, '') || ' ' || coalesce(pr.full_name, '')
    from public.sale_edit_requests r
    join public.sales s on s.id = r.sale_id
    left join public.profiles pr on pr.id = r.requested_by

    union all

    select
      'VENTAS', 'EDIT_' || r.status, r.reviewed_at,
      r.reviewed_by, pr.full_name, pr.role,
      'sale_edit_request', r.id, r.sale_id, s.seller_id,
      case r.status
        when 'APPROVED' then 'Aprobó una modificación de ' || coalesce(s.sale_number, 'sin número')
        when 'REJECTED' then 'Rechazó una modificación de ' || coalesce(s.sale_number, 'sin número')
        else 'Canceló una solicitud de edición de ' || coalesce(s.sale_number, 'sin número')
      end,
      r.review_note, jsonb_build_object('status', r.status),
      '/admin/aprobaciones/ediciones/' || r.id::text,
      coalesce(s.sale_number, '')
    from public.sale_edit_requests r
    join public.sales s on s.id = r.sale_id
    left join public.profiles pr on pr.id = r.reviewed_by
    where r.status <> 'PENDING' and r.reviewed_at is not null

    union all

    -- Edición / corrección administrativa DIRECTA (una fila por guardado =
    -- edit_group de sale_change_history). Las aprobadas por solicitud ya
    -- aparecen arriba como EDIT_APPROVED.
    select
      'VENTAS', g.edit_kind, g.changed_at,
      g.changed_by, pr.full_name, pr.role,
      'sale', g.sale_id, g.sale_id, s.seller_id,
      case when g.edit_kind = 'ADMIN_CORRECTION'
        then 'Aplicó una corrección administrativa a ' || coalesce(s.sale_number, 'sin número')
        else 'Editó la venta ' || coalesce(s.sale_number, 'una venta en borrador') end,
      g.reason, jsonb_build_object('changeCount', g.change_count, 'editGroup', g.edit_group),
      '/admin/ventas/' || g.sale_id::text,
      coalesce(s.sale_number, '') || ' ' || coalesce(pr.full_name, '')
    from (
      select h.edit_group, h.sale_id, min(h.changed_at) as changed_at,
        (array_agg(h.changed_by))[1] as changed_by, (array_agg(h.reason))[1] as reason,
        (array_agg(h.edit_kind))[1] as edit_kind, count(*) as change_count
      from public.sale_change_history h
      where h.edit_kind in ('ADMIN_EDIT', 'ADMIN_CORRECTION')
      group by h.edit_group, h.sale_id
    ) g
    join public.sales s on s.id = g.sale_id
    left join public.profiles pr on pr.id = g.changed_by

    union all

    select
      'CONTRATOS', 'CONTRACT_' || e.to_status, e.created_at,
      e.changed_by, pr.full_name, pr.role,
      'financing_contract', e.contract_id, c.sale_id, s.seller_id,
      case e.to_status
        when 'SENT' then 'Envió el contrato de ' || c.provider_name_snapshot || ' · ' || coalesce(s.sale_number, 'sin número')
        when 'SIGNED' then 'Marcó firmado el contrato de ' || c.provider_name_snapshot || ' · ' || coalesce(s.sale_number, 'sin número')
        when 'ACCREDITED' then 'Acreditó el contrato de ' || c.provider_name_snapshot || ' · ' || coalesce(s.sale_number, 'sin número')
        else 'Actualizó el contrato de ' || c.provider_name_snapshot
      end,
      e.note, jsonb_build_object('fromStatus', e.from_status, 'toStatus', e.to_status, 'providerName', c.provider_name_snapshot),
      '/admin/ventas/' || c.sale_id::text,
      coalesce(s.sale_number, '') || ' ' || c.provider_name_snapshot
    from public.financing_contract_events e
    join public.sale_financing_contracts c on c.id = e.contract_id
    join public.sales s on s.id = c.sale_id
    left join public.profiles pr on pr.id = e.changed_by

    union all

    select
      'COBROS', 'PAYMENT_SETTLED', a.settled_at,
      a.settled_by, pr.full_name, pr.role,
      'sale_payment_allocation', a.id, a.sale_id, s.seller_id,
      'Registró el cobro de ' || a.provider_name_snapshot || ' · ' || coalesce(s.sale_number, 'sin número'),
      null::text, jsonb_build_object('netCents', a.net_amount_cents),
      '/admin/ventas/' || a.sale_id::text,
      coalesce(s.sale_number, '') || ' ' || a.provider_name_snapshot
    from public.sale_payment_allocations a
    join public.sales s on s.id = a.sale_id
    left join public.profiles pr on pr.id = a.settled_by
    where a.settlement_status = 'SETTLED' and a.settled_at is not null

    union all

    select
      'PRODUCTOS', e.event_type, e.created_at,
      e.actor_id, pr.full_name, pr.role,
      'product', e.product_id, null::uuid, null::uuid,
      case e.event_type
        when 'PRODUCT_CREATED' then 'Creó el producto ' || p.name
        when 'PRODUCT_UPDATED' then 'Actualizó el producto ' || p.name
        when 'PRODUCT_ACTIVATED' then 'Activó el producto ' || p.name
        when 'PRODUCT_DEACTIVATED' then 'Desactivó el producto ' || p.name
        when 'PRODUCT_DUPLICATED' then 'Duplicó el producto ' || p.name
        when 'PRICE_CHANGED' then 'Cambió el precio de ' || p.name
        when 'VARIANT_CREATED' then 'Agregó una variante a ' || p.name
        when 'VARIANT_UPDATED' then 'Actualizó una variante de ' || p.name
        when 'VARIANT_ACTIVATED' then 'Activó una variante de ' || p.name
        when 'VARIANT_DEACTIVATED' then 'Desactivó una variante de ' || p.name
        when 'IMAGE_ADDED' then 'Agregó una imagen a ' || p.name
        when 'IMAGE_REMOVED' then 'Quitó una imagen de ' || p.name
        when 'PRIMARY_IMAGE_CHANGED' then 'Cambió la imagen principal de ' || p.name
        when 'COMMISSION_DEFAULTS_UPDATED' then 'Actualizó la comisión por defecto de ' || p.name
        else 'Actualizó ' || p.name
      end,
      null::text, e.changes,
      '/admin/productos/' || e.product_id::text,
      p.name
    from public.product_catalog_events e
    join public.products p on p.id = e.product_id
    left join public.profiles pr on pr.id = e.actor_id

    union all

    select
      'COMISIONES', e.event_type, e.created_at,
      e.actor_id, pr.full_name, pr.role,
      'sale_commission', e.commission_id, e.sale_id, s.seller_id,
      'Recalculó la comisión de ' || coalesce(s.sale_number, 'sin número') || ' por una edición aprobada',
      e.reason, jsonb_build_object('before', e.before, 'after', e.after),
      '/admin/ventas/' || e.sale_id::text,
      coalesce(s.sale_number, '')
    from public.commission_events e
    join public.sales s on s.id = e.sale_id
    left join public.profiles pr on pr.id = e.actor_id
    where e.event_type = 'COMMISSION_ADJUSTED_BY_APPROVED_SALE_EDIT'

    union all

    select
      'LIQUIDACIONES', e.event_type, e.created_at,
      e.actor_id, pr.full_name, pr.role,
      'weekly_liquidation', e.liquidation_id, null::uuid, wl.seller_id,
      case e.event_type
        when 'CREATED' then 'Creó la liquidación de ' || pr2.full_name || ' (semana del ' || wl.week_start_date || ')'
        when 'ITEMS_CLAIMED' then 'Actualizó las comisiones reclamadas de ' || pr2.full_name
        when 'ADJUSTMENT_ADDED' then 'Agregó un ajuste a la liquidación de ' || pr2.full_name
        when 'APPROVED' then 'Aprobó la liquidación de ' || pr2.full_name
        when 'PAID' then 'Marcó como PAGADA la liquidación de ' || pr2.full_name
        else 'Actualizó la liquidación de ' || pr2.full_name
      end,
      null::text, e.detail,
      '/admin/liquidaciones/' || e.liquidation_id::text,
      pr2.full_name || ' ' || wl.week_start_date::text || ' ' || coalesce(wl.payment_reference, '')
    from public.weekly_liquidation_events e
    join public.weekly_liquidations wl on wl.id = e.liquidation_id
    join public.profiles pr2 on pr2.id = wl.seller_id
    left join public.profiles pr on pr.id = e.actor_id

    union all

    select
      'VENDEDORES', e.event_type, e.created_at,
      e.actor_id, pr.full_name, pr.role,
      'seller', e.seller_id, null::uuid, e.seller_id,
      case e.event_type
        when 'SELLER_INVITED' then 'Invitó a ' || pr2.full_name
        when 'INVITATION_RESENT' then 'Reenvió la invitación a ' || pr2.full_name
        when 'INVITATION_CANCELLED' then 'Canceló la invitación a ' || pr2.full_name
        when 'SELLER_SUSPENDED' then 'Suspendió a ' || pr2.full_name
        when 'SELLER_REACTIVATED' then 'Reactivó a ' || pr2.full_name
        when 'SELLER_DISABLED' then 'Deshabilitó a ' || pr2.full_name
        else 'Actualizó la cuenta de ' || pr2.full_name
      end,
      e.reason, null::jsonb,
      '/admin/vendedores/' || e.seller_id::text,
      pr2.full_name
    from public.seller_account_events e
    join public.profiles pr2 on pr2.id = e.seller_id
    left join public.profiles pr on pr.id = e.actor_id

    union all

    -- LOGISTICA (solo acciones reales del admin — ver comentario superior)
    select
      'LOGISTICA', e.event_type, e.occurred_at,
      e.actor_id, pr.full_name, pr.role,
      'sale_unit_logistics', su.id, su.sale_id, s.seller_id,
      case e.event_type
        when 'TRANSITIONED' then 'Marcó ' || coalesce(s.sale_number, 'sin número') || ' / ' || su.product_name_snapshot
          || ' como ' || public._logistics_status_label(e.to_status)
        when 'ON_HOLD' then 'Puso en espera ' || coalesce(s.sale_number, 'sin número') || ' / ' || su.product_name_snapshot
        when 'CORRECTED' then 'Corrigió el estado logístico de ' || coalesce(s.sale_number, 'sin número') || ' / ' || su.product_name_snapshot
          || ' a ' || public._logistics_status_label(e.to_status)
        else 'Actualizó la logística de ' || coalesce(s.sale_number, 'sin número')
      end,
      e.note, jsonb_build_object('fromStatus', e.from_status, 'toStatus', e.to_status),
      '/admin/ventas/' || su.sale_id::text,
      coalesce(s.sale_number, '') || ' ' || su.product_name_snapshot || ' ' || coalesce(su.tracking_code, '')
    from public.sale_unit_logistics_events e
    join public.sale_units su on su.id = e.sale_unit_id
    join public.sales s on s.id = su.sale_id
    left join public.profiles pr on pr.id = e.actor_id
    where e.event_type in ('TRANSITIONED', 'ON_HOLD', 'CORRECTED')
  ),
  filtered as (
    select * from merged m
    where (v_category = 'ALL' or m.category = v_category)
      and (p_actor_id is null or m.actor_id = p_actor_id)
      and (p_seller_id is null or m.seller_id = p_seller_id)
      and (v_start_at is null or m.occurred_at >= v_start_at)
      and (v_end_at is null or m.occurred_at < v_end_at)
      and (v_search is null or m.search_text ilike '%' || v_search || '%')
  ),
  paged as (
    select * from filtered order by occurred_at desc, category, entity_id, event_type limit v_limit offset v_offset
  ),
  total as (
    select count(*) as n from filtered
  )
  select jsonb_build_object(
    'ok', true,
    'total', (select n from total),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'category', p.category, 'eventType', p.event_type, 'occurredAt', p.occurred_at,
        'actorId', p.actor_id, 'actorName', p.actor_name, 'actorRole', p.actor_role,
        'entityType', p.entity_type, 'entityId', p.entity_id, 'saleId', p.sale_id, 'sellerId', p.seller_id,
        'title', p.title, 'description', p.description, 'metadata', p.metadata,
        'destinationUrl', p.destination_url
      ) order by p.occurred_at desc, p.category, p.entity_id, p.event_type)
      from paged p
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

create or replace function public.admin_global_search(p_query text, p_limit int default 6)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_q     text := btrim(coalesce(p_query, ''));
  v_like  text;
  v_limit int := greatest(1, least(coalesce(p_limit, 6), 20));
  v_sales jsonb;
  v_sellers jsonb;
  v_products jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;
  if length(v_q) < 2 then
    return jsonb_build_object('ok', true, 'sales', '[]'::jsonb, 'sellers', '[]'::jsonb,
      'products', '[]'::jsonb);
  end if;
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  with matched as (
    select s.id, s.sale_number, s.status, s.sale_total_cents, s.sale_date, s.created_at,
      coalesce(nullif(btrim(coalesce(bp.first_name, '') || ' ' || coalesce(bp.last_name, '')), ''), 'Sin comprador') as buyer_name,
      pr.full_name as seller_name,
      (select string_agg(coalesce(su.product_name_snapshot, '') ||
                coalesce(' · ' || su.tracking_code, ''), ', ' order by su.position)
         from public.sale_units su where su.sale_id = s.id) as units_text,
      (select string_agg(distinct a.provider_name_snapshot, ', ')
         from public.sale_payment_allocations a
         where a.sale_id = s.id and a.provider_name_snapshot ilike v_like) as provider_hit
    from public.sales s
    join public.profiles pr on pr.id = s.seller_id
    left join public.sale_parties bp on bp.sale_id = s.id and bp.party_role = 'PRIMARY_BUYER'
    left join public.sale_cuba_recipients rc on rc.sale_id = s.id
    where s.operation_type = 'CUBA' and (
         s.sale_number ilike v_like
      or (coalesce(bp.first_name, '') || ' ' || coalesce(bp.last_name, '')) ilike v_like
      or coalesce(bp.phone, '') ilike v_like
      or coalesce(rc.full_name, '') ilike v_like
      or coalesce(pr.full_name, '') ilike v_like
      or exists (select 1 from public.sale_units su where su.sale_id = s.id
                   and (su.tracking_code ilike v_like or su.product_name_snapshot ilike v_like))
      or exists (select 1 from public.sale_payment_allocations a
                   where a.sale_id = s.id and a.provider_name_snapshot ilike v_like))
    order by coalesce(s.sale_date, s.created_at::date) desc, s.created_at desc
    limit v_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'saleNumber', m.sale_number, 'status', m.status,
      'saleTotalCents', m.sale_total_cents, 'saleDate', coalesce(m.sale_date, m.created_at::date),
      'buyerName', m.buyer_name, 'sellerName', m.seller_name,
      'unitsText', m.units_text, 'provider', m.provider_hit)), '[]'::jsonb)
    into v_sales from matched m;

  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_sellers from (
    select jsonb_build_object('id', p.id, 'fullName', p.full_name, 'email', p.email,
             'accountStatus', p.account_status) as x
    from public.profiles p
    where p.role = 'seller' and (coalesce(p.full_name, '') ilike v_like or coalesce(p.email, '') ilike v_like)
    order by p.full_name
    limit v_limit) t;

  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_products from (
    select jsonb_build_object('id', p.id, 'name', p.name, 'brand', p.brand, 'isActive', p.is_active) as x
    from public.products p
    where p.name ilike v_like or coalesce(p.brand, '') ilike v_like
    order by p.is_active desc, p.name
    limit v_limit) t;

  return jsonb_build_object('ok', true, 'sales', v_sales, 'sellers', v_sellers,
    'products', v_products);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Productos, reportes y logística (solo lectura) — sin stock ni VIN.
-- ---------------------------------------------------------------------------
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
        'basePriceCents', b.base_price_cents,
        'cubaTotalCents', b.cuba_total_cents,
        'variantCount', (select count(*) from public.product_variants v where v.product_id = b.id and v.is_active),
        'defaultReferencePriceCents', b.default_reference_price_cents,
        'defaultBaseCommissionCents', b.default_base_commission_cents
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
        'id', v.id, 'colorName', v.color_name,
        'isActive', v.is_active,
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
    color_normalized = lower(btrim(v_label))
  where id = p_variant_id;

  insert into public.product_catalog_events (product_id, variant_id, event_type, actor_id, changes)
  values (v_old.product_id, p_variant_id, 'VARIANT_UPDATED', v_uid, jsonb_build_object(
    'from', jsonb_build_object('colorName', v_old.color_name),
    'to', jsonb_build_object('colorName', v_label)));

  return jsonb_build_object('ok', true, 'variantId', p_variant_id);
end;
$$;

create or replace function public.admin_reports_products(
  p_start date default null, p_end date default null, p_category text default null, p_stock_mode text default 'ALL'
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  -- p_stock_mode: parámetro OBSOLETO (se ignora; se conserva la firma).
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
        'productId', p.id, 'productName', p.name, 'category', p.category,
        'unitsSold', coalesce(u.units_sold, 0), 'salesCount', coalesce(u.sales_count, 0),
        'revenueCents', coalesce(u.revenue_cents, 0),
        'avgSalePriceCents', case when coalesce(u.units_sold, 0) = 0 then null else round(u.revenue_cents::numeric / u.units_sold) end,
        'pendingUnits', coalesce(u.pending_units, 0), 'soldUnits', coalesce(u.sold_units, 0), 'paidUnits', coalesce(u.paid_units, 0),
        'commissionGeneratedCents', coalesce(c.commission_cents, 0)
      ) order by coalesce(u.revenue_cents, 0) desc, p.name)
      from public.products p
      left join lateral (
        select
          count(su.id) filter (where s.status in ('SOLD', 'PAID')) as units_sold,
          count(distinct s.id) filter (where s.status in ('SOLD', 'PAID')) as sales_count,
          coalesce(sum(su.agreed_price_cents) filter (where s.status in ('SOLD', 'PAID')), 0) as revenue_cents,
          count(su.id) filter (where s.status = 'PENDING') as pending_units,
          count(su.id) filter (where s.status = 'SOLD') as sold_units,
          count(su.id) filter (where s.status = 'PAID') as paid_units
        from public.sale_units su
        join public.sales s on s.id = su.sale_id
        where su.product_id = p.id and s.operation_type = 'CUBA'
          and (p_start is null or s.sale_date >= p_start) and (p_end is null or s.sale_date <= p_end)
      ) u on true
      left join lateral (
        select sum(sc.final_commission_cents) as commission_cents
        from public.sale_commissions sc
        join public.sale_units su2 on su2.id = sc.sale_unit_id
        where su2.product_id = p.id
      ) c on true
      where (p_category is null or p.category = p_category)
    ), '[]'::jsonb)
  );
end;
$$;

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
  left join public.sale_unit_logistics l on l.sale_unit_id = su.id
  where su.sale_id = p_sale_id
    and (public.sale_is_own(p_sale_id) or public.is_admin());
$$;

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
      rec.full_name as recipient_name, rec.province, rec.municipality
    from public.sale_unit_logistics l
    join public.sale_units su on su.id = l.sale_unit_id
    join public.sales s on s.id = su.sale_id
    join public.profiles pr on pr.id = s.seller_id
    left join public.sale_cuba_recipients rec on rec.sale_id = s.id
    where s.operation_type = 'CUBA'
      and (v_status = 'ALL' or l.status = v_status)
      and (v_commercial = 'ALL' or s.status = v_commercial)
      and (p_seller_id is null or s.seller_id = p_seller_id)
      and (p_product_id is null or su.product_id = p_product_id)
      and (v_search is null
        or s.sale_number ilike '%' || v_search || '%'
        or su.tracking_code ilike '%' || v_search || '%'
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
      rec.full_name as recipient_name, rec.province, rec.municipality
    from public.sale_unit_logistics l
    join public.sale_units su on su.id = l.sale_unit_id
    join public.sales s on s.id = su.sale_id
    join public.profiles pr on pr.id = s.seller_id
    left join public.sale_cuba_recipients rec on rec.sale_id = s.id
    where s.operation_type = 'CUBA'
      and (v_status = 'ALL' or l.status = v_status)
      and (v_commercial = 'ALL' or s.status = v_commercial)
      and (p_seller_id is null or s.seller_id = p_seller_id)
      and (p_product_id is null or su.product_id = p_product_id)
      and (v_search is null
        or s.sale_number ilike '%' || v_search || '%'
        or su.tracking_code ilike '%' || v_search || '%'
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
        'trackingCode', b.tracking_code,
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
