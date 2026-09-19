-- ===========================================================================
-- SMILE MOTORS · ADMIN — CONTROL TOTAL DE VENTAS (edición/corrección
-- administrativa directa, transiciones administrativas, búsqueda global).
--
-- Nada de esto crea un segundo motor ni una segunda auditoría:
--   * `update_confirmed_cuba_sale` sigue siendo el ÚNICO motor de mutación
--     (validación, snapshots desde catálogo, totales autoritativos,
--     `sale_change_history`). Solo se extiende con un GUC transaccional que
--     únicamente `admin_update_cuba_sale` fija.
--   * `sale_change_history` gana `edit_kind` (nullable) para distinguir
--     EDICIÓN ADMIN / CORRECCIÓN ADMINISTRATIVA / SOLICITUD APROBADA.
--   * `mark_sale_sold` / `request_sale_review`: el admin puede ejecutar la
--     transición, pasando EXACTAMENTE las mismas validaciones del vendedor.
--   * La conciliación formal (Fase 2) sigue sin implementarse a propósito:
--     solo se DEVUELVE/MUESTRA la señal derivada, nunca se fabrica un pago.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. sale_change_history.edit_kind
-- ---------------------------------------------------------------------------
alter table public.sale_change_history
  add column if not exists edit_kind text;
alter table public.sale_change_history
  drop constraint if exists sale_change_history_edit_kind_check;
alter table public.sale_change_history
  add constraint sale_change_history_edit_kind_check
  check (edit_kind is null or edit_kind in ('APPROVED_REQUEST', 'ADMIN_EDIT', 'ADMIN_CORRECTION'));
comment on column public.sale_change_history.edit_kind is
  'Origen del cambio: APPROVED_REQUEST (solicitud del vendedor aprobada), ADMIN_EDIT (edición administrativa directa), ADMIN_CORRECTION (corrección administrativa de una venta PAGADA). NULL = ediciones históricas previas a esta columna.';

-- Histórico: toda fila con request_id proviene de una solicitud aprobada.
update public.sale_change_history set edit_kind = 'APPROVED_REQUEST'
  where request_id is not null and edit_kind is null;

create index if not exists sale_change_history_admin_kind_idx
  on public.sale_change_history (changed_at desc)
  where edit_kind in ('ADMIN_EDIT', 'ADMIN_CORRECTION');

create or replace function public.log_sale_field_change(
  p_group uuid, p_sale_id uuid, p_by uuid, p_reason text,
  p_path text, p_type text, p_old text, p_new text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id   uuid := nullif(current_setting('motods.edit_request_id', true), '')::uuid;
  v_requested_by uuid := nullif(current_setting('motods.edit_requested_by', true), '')::uuid;
  v_edit_kind    text := nullif(current_setting('motods.edit_kind', true), '');
begin
  if p_type = 'UPDATE' and p_old is not distinct from p_new then
    return;
  end if;
  insert into public.sale_change_history (
    sale_id, changed_by, reason, edit_group,
    field_path, change_type, old_value, new_value,
    request_id, requested_by, edit_kind)
  values (p_sale_id, p_by, p_reason, p_group,
    p_path, p_type, p_old, p_new,
    v_request_id, v_requested_by,
    coalesce(v_edit_kind, case when v_request_id is not null then 'APPROVED_REQUEST' end));
end;
$$;
revoke all on function public.log_sale_field_change(uuid, uuid, uuid, text, text, text, text, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. commission_events: nuevo tipo de evento (ajuste por edición admin).
-- ---------------------------------------------------------------------------
alter table public.commission_events drop constraint if exists commission_events_event_type_check;
alter table public.commission_events add constraint commission_events_event_type_check
  check (event_type in (
    'COMMISSION_CALCULATED', 'COMMISSION_RECALCULATED',
    'COMMISSION_ELIGIBLE', 'COMMISSION_ADJUSTED_BY_APPROVED_SALE_EDIT',
    'COMMISSION_ADJUSTED_BY_ADMIN_EDIT'
  ));

-- ---------------------------------------------------------------------------
-- 3. update_confirmed_cuba_sale — ÚNICOS cambios sobre la versión vigente
--    (20260910280000_admin_aprobaciones.sql): (a) DRAFT/PAID solo bajo el GUC
--    `motods.admin_direct_edit`; (b) una unidad puede conservar un producto
--    ya desactivado en el catálogo (no se exige is_active al MISMO producto);
--    (c) una unidad nueva antes de SOLD no adelanta su código de seguimiento
--    (lo genera mark_sale_sold). Sigue revocada para clientes.
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

  -- Reservado/vendido: si una unidad ya tiene un VIN RESERVED/SOLD asignado,
  -- el cambio de PRODUCTO **o VARIANTE** propuesto se rechaza — la
  -- integridad de inventario tiene prioridad (nunca se reasigna VIN por
  -- esta vía; el VIN físico ya está atado a un producto/variante exactos).
  for v_u in select * from jsonb_array_elements(v_units_json) loop
    if nullif(v_u->>'id', '') is not null then
      if exists (
        select 1
        from public.sale_units su
        join public.inventory_units iu on iu.id = su.inventory_unit_id
        where su.id = (v_u->>'id')::uuid
          and iu.status in ('RESERVED', 'SOLD')
          and (
            su.product_id is distinct from nullif(v_u->>'productId', '')::uuid
            or su.product_variant_id is distinct from nullif(v_u->>'variantId', '')::uuid
          )
      ) then
        v_errors := array_append(v_errors, 'UNIT_INVENTORY_LOCKED');
      end if;
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
-- 4. mark_sale_sold — ÚNICO cambio sobre la versión vigente
--    (20260910330000_admin_logistica.sql): un ADMIN también puede marcar
--    PENDING → SOLD, con las MISMAS validaciones (contratos firmados, datos,
--    config de comisión, inventario). El historial registra el motivo.
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

  insert into public.sale_status_history (sale_id, from_status, to_status, changed_by, reason)
  values (p_sale_id, 'PENDING', 'SOLD', v_uid,
    case when v_sale.seller_id <> v_uid then 'Marcada como vendida por administración' end);

  return jsonb_build_object('ok', true, 'saleId', p_sale_id, 'saleNumber', v_number,
    'status', 'SOLD', 'saleTotalCents', v_sale_total);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. request_sale_review — ÚNICO cambio: un ADMIN también puede enviar
--    DRAFT → PENDING (mismas validaciones).
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

  v_errors := public.validate_cuba_sale_for_review(p_sale_id);
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

-- ===========================================================================
-- 6. admin_update_cuba_sale — EDICIÓN / CORRECCIÓN ADMINISTRATIVA DIRECTA.
--
--    El admin NO se envía una solicitud de edición a sí mismo: aplica una
--    corrección de confianza, validada y auditada, en una sola transacción.
--    Reutiliza el MISMO motor que las aprobaciones (`update_confirmed_cuba_sale`:
--    validación, snapshots de catálogo derivados del servidor, totales
--    autoritativos y `sale_change_history`) — nunca un segundo motor.
--
--    Reglas por estado:
--      DRAFT   → editable completo (motivo opcional).
--      PENDING → editable completo; motivo OBLIGATORIO.
--      SOLD    → motivo OBLIGATORIO; precio → recálculo de comisión con el
--                SNAPSHOT (nunca config viva); sin alta/baja de unidades;
--                sin cambio de producto si ya hay comisión snapshoteada.
--      PAID    → solo vía `p_admin_correction = true` (CORRECCIÓN
--                ADMINISTRATIVA) + motivo; la verdad financiera NO se toca:
--                bloquea cualquier cambio de importe/unidades/extras
--                (`PAID_FINANCIAL_CHANGE_BLOCKED`). La conciliación de
--                sobre/infra-pagos (Fase 2) sigue pendiente de diseño.
--    Inventario: nunca cambia producto/variante de una unidad con VIN
--    asignado ni quita una unidad con VIN (`UNIT_INVENTORY_LOCKED`).
--    Concurrencia: `p_expected_updated_at` (opcional) → `SALE_CHANGED`.
--    Nunca toca asignaciones de pago, contratos ni cobros: si el nuevo total
--    no coincide con lo asignado/cobrado, se DEVUELVE la señal
--    `reconciliation.required` (derivada) — nunca se fabrica un pago.
-- ===========================================================================
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
  v_inv_locked  text[] := array[]::text[];
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
      if v_old_unit.inventory_unit_id is not null then
        v_inv_locked := array_append(v_inv_locked, v_old_unit.id::text);
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

    -- Producto/variante con VIN asignado: nunca un VIN de otro producto/variante.
    if v_old_unit.inventory_unit_id is not null and (
         v_old_unit.product_id is distinct from nullif(v_u->>'productId', '')::uuid
      or v_old_unit.product_variant_id is distinct from nullif(v_u->>'variantId', '')::uuid) then
      v_inv_locked := array_append(v_inv_locked, v_old_unit.id::text);
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
  if array_length(v_inv_locked, 1) is not null then
    return jsonb_build_object('ok', false, 'code', 'UNIT_INVENTORY_LOCKED', 'saleUnitIds', to_jsonb(v_inv_locked));
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
revoke all on function public.admin_update_cuba_sale(uuid, jsonb, text, boolean, timestamptz) from public, anon;
grant execute on function public.admin_update_cuba_sale(uuid, jsonb, text, boolean, timestamptz) to authenticated;

-- ===========================================================================
-- 7. admin_global_search — búsqueda global del Admin (Ctrl/Cmd + K).
--    Número de venta, código de seguimiento, comprador/destinatario,
--    vendedor, VIN y producto. Solo lectura; resultados enlazan a las
--    páginas autoritativas. ADMIN-only.
-- ===========================================================================
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
  v_units jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;
  if length(v_q) < 2 then
    return jsonb_build_object('ok', true, 'sales', '[]'::jsonb, 'sellers', '[]'::jsonb,
      'products', '[]'::jsonb, 'units', '[]'::jsonb);
  end if;
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  with matched as (
    select s.id, s.sale_number, s.status, s.sale_total_cents, s.sale_date, s.created_at,
      coalesce(nullif(btrim(coalesce(bp.first_name, '') || ' ' || coalesce(bp.last_name, '')), ''), 'Sin comprador') as buyer_name,
      pr.full_name as seller_name,
      (select string_agg(coalesce(su.product_name_snapshot, '') ||
                coalesce(' · ' || su.tracking_code, ''), ', ' order by su.position)
         from public.sale_units su where su.sale_id = s.id) as units_text,
      (select iu.vin from public.sale_units su join public.inventory_units iu on iu.id = su.inventory_unit_id
         where su.sale_id = s.id and iu.vin ilike v_like limit 1) as vin_hit
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
      or exists (select 1 from public.sale_units su join public.inventory_units iu on iu.id = su.inventory_unit_id
                   where su.sale_id = s.id and iu.vin ilike v_like))
    order by coalesce(s.sale_date, s.created_at::date) desc, s.created_at desc
    limit v_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'saleNumber', m.sale_number, 'status', m.status,
      'saleTotalCents', m.sale_total_cents, 'saleDate', coalesce(m.sale_date, m.created_at::date),
      'buyerName', m.buyer_name, 'sellerName', m.seller_name,
      'unitsText', m.units_text, 'vin', m.vin_hit)), '[]'::jsonb)
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

  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_units from (
    select jsonb_build_object('id', iu.id, 'vin', iu.vin, 'status', iu.status,
             'productName', p.name, 'variant', pv.color_name) as x
    from public.inventory_units iu
    join public.products p on p.id = iu.product_id
    left join public.product_variants pv on pv.id = iu.variant_id
    where iu.vin ilike v_like
    order by iu.vin
    limit v_limit) t;

  return jsonb_build_object('ok', true, 'sales', v_sales, 'sellers', v_sellers,
    'products', v_products, 'units', v_units);
end;
$$;
revoke all on function public.admin_global_search(text, int) from public, anon;
grant execute on function public.admin_global_search(text, int) to authenticated;


-- ---------------------------------------------------------------------------
-- 8. admin_activity_feed — ÚNICO cambio sobre la versión vigente
--    (20260910330100_admin_logistica_actividad_alertas.sql): nueva rama con
--    las ediciones/correcciones administrativas directas.
-- ---------------------------------------------------------------------------
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
      'INVENTARIO', e.event_type, e.created_at,
      e.actor_id, pr.full_name, pr.role,
      'inventory_unit', e.inventory_unit_id, e.sale_id, s.seller_id,
      case e.event_type
        when 'UNIT_CREATED' then 'Creó la unidad ' || coalesce(iu.vin, 'sin VIN') || ' de ' || p.name
        when 'UNIT_IMPORTED' then 'Importó la unidad ' || coalesce(iu.vin, 'sin VIN') || ' de ' || p.name
        when 'VIN_UPDATED' then 'Actualizó el VIN de una unidad de ' || p.name
        when 'UNIT_RESERVED' then 'Asignó el VIN ' || coalesce(iu.vin, 'sin VIN') || ' a la venta ' || coalesce(s.sale_number, 'sin número')
        when 'RESERVATION_RELEASED' then 'Liberó la reserva del VIN ' || coalesce(iu.vin, 'sin VIN')
        when 'UNIT_SOLD' then 'Marcó vendida la unidad ' || coalesce(iu.vin, 'sin VIN')
        when 'COMMISSION_CONFIG_UPDATED' then 'Configuró la comisión del VIN ' || coalesce(iu.vin, 'sin VIN')
        else 'Actualizó la unidad ' || coalesce(iu.vin, 'sin VIN')
      end,
      e.reason, e.changes,
      '/admin/inventario/' || e.inventory_unit_id::text,
      coalesce(iu.vin, '') || ' ' || p.name || ' ' || coalesce(s.sale_number, '')
    from public.inventory_unit_events e
    join public.inventory_units iu on iu.id = e.inventory_unit_id
    join public.products p on p.id = iu.product_id
    left join public.profiles pr on pr.id = e.actor_id
    left join public.sales s on s.id = e.sale_id

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
revoke all on function public.admin_activity_feed(text, uuid, uuid, date, date, text, int, int) from public, anon;
grant execute on function public.admin_activity_feed(text, uuid, uuid, date, date, text, int, int) to authenticated;
