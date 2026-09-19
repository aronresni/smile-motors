-- ===========================================================================
-- ADMIN · CENTRO DE APROBACIONES — FASE 1.
--
-- Reutiliza TODO lo existente:
--   - `sale_change_history` (auditoría ya construida) — se extiende con 2
--     columnas nullable (`request_id`, `requested_by`), nunca duplicada.
--   - `update_confirmed_cuba_sale` (motor de mutación/snapshot/totales ya
--     probado) — se generaliza de SOLD a (PENDING, SOLD) y se CIERRA su
--     llamada directa por el vendedor (hallazgo crítico de la inspección:
--     hoy cualquier vendedor puede reescribir una venta SOLD sin admin).
--   - `sale_settlement_amounts`, `admin_mark_sale_paid`, `mark_financing_*`,
--     `sale_financing_contracts`/`financing_contract_events` — sin tocar.
--
-- Único esquema NUEVO: `sale_edit_requests` (no existía ninguna cola de
-- solicitudes pendientes de aprobar — `sale_change_history` es el registro
-- de cambios YA aplicados, un concepto distinto).
-- ===========================================================================

-- ===========================================================================
-- 1. sale_edit_requests
-- ===========================================================================
create table public.sale_edit_requests (
  id                uuid primary key default gen_random_uuid(),
  sale_id           uuid not null references public.sales (id) on delete cascade,
  requested_by      uuid not null references public.profiles (id) on delete restrict,
  status            text not null default 'PENDING'
                      check (status in ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  reason            text not null,
  requested_changes jsonb not null,             -- [{path, oldValue, newValue}, ...]
  sale_status_at_request text not null,         -- PENDING | SOLD — para mostrar contexto
  created_at        timestamptz not null default now(),
  reviewed_at       timestamptz,
  reviewed_by       uuid references public.profiles (id) on delete set null,
  review_note       text
);
create index sale_edit_requests_sale_idx on public.sale_edit_requests (sale_id, created_at desc);
create index sale_edit_requests_status_idx on public.sale_edit_requests (status, created_at desc);
create index sale_edit_requests_requested_by_idx on public.sale_edit_requests (requested_by);

-- Como máximo UNA solicitud PENDING por venta (regla preferida por la tarea).
create unique index sale_edit_requests_one_pending_per_sale
  on public.sale_edit_requests (sale_id) where status = 'PENDING';

alter table public.sale_edit_requests enable row level security;
grant select on public.sale_edit_requests to authenticated;

-- Solo lectura directa; toda escritura pasa por RPC `SECURITY DEFINER`
-- (mismo patrón que el resto del proyecto — nunca un UPDATE/INSERT arbitrario).
create policy sale_edit_requests_select on public.sale_edit_requests
  for select to authenticated
  using (requested_by = auth.uid() or public.sale_is_own(sale_id) or public.is_admin());

-- ---------------------------------------------------------------------------
-- 2. sale_change_history: 2 columnas nullable (reutilizada, no duplicada).
-- ---------------------------------------------------------------------------
alter table public.sale_change_history
  add column if not exists request_id uuid references public.sale_edit_requests (id) on delete set null,
  add column if not exists requested_by uuid references public.profiles (id) on delete set null;
create index if not exists sale_change_history_request_idx
  on public.sale_change_history (request_id) where request_id is not null;

-- ---------------------------------------------------------------------------
-- 3. log_sale_field_change — MISMA firma; ahora también graba
--    request_id/requested_by cuando la mutación viene de una aprobación
--    (leídos de GUC transaccionales, nunca de un parámetro que el cliente
--    pudiera falsificar directamente, ya que esta función es interna).
-- ---------------------------------------------------------------------------
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
begin
  if p_type = 'UPDATE' and p_old is not distinct from p_new then
    return;
  end if;
  insert into public.sale_change_history (
    sale_id, changed_by, reason, edit_group,
    field_path, change_type, old_value, new_value,
    request_id, requested_by)
  values (p_sale_id, p_by, p_reason, p_group,
    p_path, p_type, p_old, p_new,
    v_request_id, v_requested_by);
end;
$$;
revoke all on function public.log_sale_field_change(uuid, uuid, uuid, text, text, text, text, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. update_confirmed_cuba_sale — CIERRE DEL BYPASS + generalización de
--    estado. ÚNICOS cambios reales sobre la versión vigente
--    (20260910200000_sale_review_workflow.sql:965): (a) el chequeo de
--    propiedad ahora también acepta un admin actuando en nombre del
--    vendedor SOLO bajo el GUC transaccional `motods.acting_as_seller`
--    (que únicamente `approve_sale_edit_request` puede fijar, y solo para
--    la transacción actual — mismo patrón ya usado en Vendedores); (b) el
--    estado exigido pasa de solo SOLD a (PENDING, SOLD). El resto de la
--    función (validación, mutación de cada tabla, recomputo de totales,
--    auditoría) es EXACTAMENTE igual. Después de esto se revoca su
--    ejecución directa desde `authenticated`: a partir de ahora SOLO
--    `approve_sale_edit_request` puede invocarla (llamada interna, que
--    corre con los privilegios del dueño de la función, no del rol
--    `authenticated` revocado).
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
  if v_sale.status not in ('PENDING', 'SOLD') then
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
        where p.id = nullif(v_u->>'productId', '')::uuid and p.is_active;
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
      where p.id = (v_u->>'productId')::uuid and p.is_active;

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
      v_track := 'CU-' || v_year || '-'
        || lpad(nextval('public.sale_unit_tracking_seq')::text, 6, '0');
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
          || ' (' || v_track || ')');
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

-- CIERRE DEL BYPASS: a partir de aquí ningún cliente (vendedor NI admin)
-- puede invocar esta función directo por RPC. Solo queda alcanzable desde
-- dentro de `approve_sale_edit_request` (llamada interna).
revoke all on function public.update_confirmed_cuba_sale(uuid, jsonb, text) from public, anon, authenticated;

-- ===========================================================================
-- 5. sale_edit_snapshot — payload base (mismo shape que espera
--    `update_confirmed_cuba_sale`) + mapa plano path→valor actual (mismo
--    vocabulario que `sale_change_history.field_path`). Se usa para: (a)
--    que el cliente arme el diff al enviar la solicitud, (b) detección de
--    conflicto en el envío y en la aprobación, (c) reconstrucción del
--    payload completo al aprobar.
-- ===========================================================================
create or replace function public.sale_edit_snapshot(p_sale_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
stable
as $$
declare
  v_buyer public.sale_parties;
  v_rec   public.sale_cuba_recipients;
  v_del   public.sale_deliveries;
  v_notes text;
  v_payload jsonb;
  v_flat  jsonb := '{}'::jsonb;
  v_unit  record;
begin
  if not (public.sale_is_own(p_sale_id) or public.is_admin()) then
    return jsonb_build_object('ok', false, 'code', 'NOT_OWNER');
  end if;

  select * into v_buyer from public.sale_parties where sale_id = p_sale_id and party_role = 'PRIMARY_BUYER';
  select * into v_rec from public.sale_cuba_recipients where sale_id = p_sale_id;
  select * into v_del from public.sale_deliveries where sale_id = p_sale_id;
  select internal_notes into v_notes from public.sales where id = p_sale_id;

  v_payload := jsonb_build_object(
    'buyer', jsonb_build_object(
      'firstName', v_buyer.first_name, 'lastName', v_buyer.last_name,
      'dateOfBirth', v_buyer.date_of_birth, 'documentNumber', v_buyer.document_number,
      'documentExpiration', v_buyer.document_expiration, 'phone', v_buyer.phone, 'email', v_buyer.email,
      'addressLine1', v_buyer.address_line1, 'addressLine2', v_buyer.address_line2,
      'city', v_buyer.city, 'state', v_buyer.state, 'postalCode', v_buyer.postal_code),
    'coBuyer', (select jsonb_build_object(
        'firstName', first_name, 'lastName', last_name, 'dateOfBirth', date_of_birth,
        'documentNumber', document_number, 'phone', phone, 'email', email)
      from public.sale_parties where sale_id = p_sale_id and party_role = 'CO_BUYER'),
    'cubaRecipient', jsonb_build_object(
      'fullName', v_rec.full_name, 'identityNumber', v_rec.identity_number,
      'deliveryAddress', v_rec.delivery_address, 'municipality', v_rec.municipality,
      'province', v_rec.province, 'phonePrimary', v_rec.primary_phone, 'phoneSecondary', v_rec.secondary_phone),
    'delivery', jsonb_build_object('method', v_del.method, 'reference', v_del.pickup_reference),
    'units', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'productId', product_id, 'variantId', product_variant_id,
        'agreedPriceCents', agreed_price_cents) order by position)
      from public.sale_units where sale_id = p_sale_id), '[]'::jsonb),
    'extras', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'description', description, 'quantity', quantity, 'unitAmountCents', unit_price_cents)
        order by position)
      from public.sale_extras where sale_id = p_sale_id), '[]'::jsonb),
    'documents', '[]'::jsonb,
    'internalNotes', v_notes
  );

  v_flat := v_flat
    || jsonb_build_object('buyer.first_name', v_buyer.first_name, 'buyer.last_name', v_buyer.last_name,
         'buyer.phone', v_buyer.phone, 'buyer.email', v_buyer.email,
         'buyer.address_line1', v_buyer.address_line1, 'buyer.address_line2', v_buyer.address_line2,
         'buyer.city', v_buyer.city, 'buyer.state', v_buyer.state, 'buyer.postal_code', v_buyer.postal_code,
         'buyer.document_number', v_buyer.document_number)
    || jsonb_build_object('recipient.full_name', v_rec.full_name, 'recipient.identity_number', v_rec.identity_number,
         'recipient.delivery_address', v_rec.delivery_address, 'recipient.municipality', v_rec.municipality,
         'recipient.province', v_rec.province, 'recipient.primary_phone', v_rec.primary_phone,
         'recipient.secondary_phone', v_rec.secondary_phone)
    || jsonb_build_object('delivery.method', v_del.method, 'delivery.pickup_reference', v_del.pickup_reference)
    || jsonb_build_object('internal_notes', v_notes);

  for v_unit in select * from public.sale_units where sale_id = p_sale_id loop
    v_flat := v_flat || jsonb_build_object(
      'units.' || v_unit.id::text || '.variant_id', v_unit.product_variant_id::text,
      'units.' || v_unit.id::text || '.agreed_price_cents', v_unit.agreed_price_cents::text);
  end loop;
  for v_unit in select * from public.sale_extras where sale_id = p_sale_id loop
    v_flat := v_flat || jsonb_build_object(
      'extras.' || v_unit.id::text || '.description', v_unit.description,
      'extras.' || v_unit.id::text || '.quantity', v_unit.quantity::text,
      'extras.' || v_unit.id::text || '.unit_price_cents', v_unit.unit_price_cents::text);
  end loop;

  return jsonb_build_object('ok', true, 'payload', v_payload, 'flat', v_flat);
end;
$$;
revoke all on function public.sale_edit_snapshot(uuid) from public, anon;
grant execute on function public.sale_edit_snapshot(uuid) to authenticated;

-- ===========================================================================
-- 6. request_sale_edit — SELLER: crea la solicitud. NUNCA muta la venta.
-- ===========================================================================
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

  select flat into v_flat from public.sale_edit_snapshot(p_sale_id);

  for v_entry in select * from jsonb_array_elements(p_changes) loop
    v_path := v_entry->>'path';
    if v_path is null or v_path = '' then
      return jsonb_build_object('ok', false, 'code', 'INVALID_CHANGE_PATH');
    end if;

    -- Lista blanca de rutas editables (whitelist server-side, nunca solo
    -- de UI): campos escalares, o `units.<id-de-esta-venta>.{variant_id,
    -- agreed_price_cents}` / `extras.<id-de-esta-venta>.{...}`.
    if v_path in (
      'buyer.first_name', 'buyer.last_name', 'buyer.phone', 'buyer.email',
      'buyer.address_line1', 'buyer.address_line2', 'buyer.city', 'buyer.state',
      'buyer.postal_code', 'buyer.document_number',
      'recipient.full_name', 'recipient.identity_number', 'recipient.delivery_address',
      'recipient.municipality', 'recipient.province', 'recipient.primary_phone', 'recipient.secondary_phone',
      'delivery.method', 'delivery.pickup_reference', 'internal_notes'
    ) then
      null; -- ruta escalar válida
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
      -- Fail-fast: variante en una unidad con VIN RESERVED/SOLD ya
      -- asignado — la integridad de inventario tiene prioridad (misma
      -- regla que se re-verifica, de forma autoritativa, en la aprobación).
      if v_field = 'variant_id' and exists (
        select 1 from public.sale_units su
        join public.inventory_units iu on iu.id = su.inventory_unit_id
        where su.id = v_id and iu.status in ('RESERVED', 'SOLD')
      ) then
        return jsonb_build_object('ok', false, 'code', 'UNIT_INVENTORY_LOCKED', 'path', v_path);
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

    -- El valor "antes" declarado por el cliente debe coincidir con la
    -- realidad AHORA MISMO (detección de conflicto temprana; la
    -- verificación definitiva y autoritativa vuelve a ocurrir en la
    -- aprobación, por si la venta cambia mientras la solicitud espera).
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
revoke all on function public.request_sale_edit(uuid, text, jsonb) from public, anon;
grant execute on function public.request_sale_edit(uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. cancel_sale_edit_request — SELLER, solo su propia solicitud PENDING.
-- ---------------------------------------------------------------------------
create or replace function public.cancel_sale_edit_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_req public.sale_edit_requests;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  select * into v_req from public.sale_edit_requests where id = p_request_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'REQUEST_NOT_FOUND');
  end if;
  if v_req.requested_by <> v_uid then
    return jsonb_build_object('ok', false, 'code', 'NOT_OWNER');
  end if;
  if v_req.status <> 'PENDING' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATUS');
  end if;
  update public.sale_edit_requests set status = 'CANCELLED', reviewed_at = now() where id = p_request_id;
  return jsonb_build_object('ok', true, 'requestId', p_request_id);
end;
$$;
revoke all on function public.cancel_sale_edit_request(uuid) from public, anon;
grant execute on function public.cancel_sale_edit_request(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. approve_sale_edit_request — ADMIN. Transaccional. Reconstruye el
--    payload completo (snapshot actual + diff aprobado) y reutiliza
--    `update_confirmed_cuba_sale` para aplicarlo, recalcular totales y
--    auditar — exactamente la misma lógica que ya usaba la edición directa,
--    ahora detrás del gate de aprobación.
-- ---------------------------------------------------------------------------
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

  select payload, flat into v_payload, v_flat from public.sale_edit_snapshot(v_req.sale_id);

  -- Conflicto: cada valor "antes" declarado debe seguir coincidiendo con
  -- la realidad ACTUAL de la venta (item 6 del enunciado de la tarea).
  for v_entry in select * from jsonb_array_elements(v_req.requested_changes) loop
    v_path := v_entry->>'path';
    v_current := v_flat->>v_path;
    if coalesce(v_entry->>'oldValue', '') is distinct from coalesce(v_current, '') then
      return jsonb_build_object('ok', false, 'code', 'REQUEST_CONFLICT',
        'path', v_path, 'currentValue', v_current, 'declaredOldValue', v_entry->>'oldValue');
    end if;
  end loop;

  -- Reconstruye el payload completo: snapshot actual + cada cambio aprobado.
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

  -- Unidades/extras: reescribe cada elemento del arreglo aplicando los
  -- cambios que le correspondan por id (sin alta/baja en Fase 1).
  v_units := v_payload->'units';
  for v_u in select * from jsonb_array_elements(v_units) loop
    v_id_part := v_u->>'id';
    for v_entry in select * from jsonb_array_elements(v_req.requested_changes) loop
      v_path := v_entry->>'path';
      if v_path = 'units.' || v_id_part || '.variant_id' then
        v_u := jsonb_set(v_u, '{variantId}', to_jsonb(nullif(v_entry->>'newValue', '')));
      elsif v_path = 'units.' || v_id_part || '.agreed_price_cents' then
        v_u := jsonb_set(v_u, '{agreedPriceCents}', to_jsonb((v_entry->>'newValue')::bigint));
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
    return jsonb_build_object('ok', true, 'requestId', p_request_id, 'saleId', v_req.sale_id,
      'changeCount', v_result->'changeCount');
  end if;

  return jsonb_build_object('ok', false, 'code', 'APPLY_FAILED', 'detail', v_result);
end;
$$;
revoke all on function public.approve_sale_edit_request(uuid) from public, anon;
grant execute on function public.approve_sale_edit_request(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. reject_sale_edit_request — ADMIN. Nunca toca datos de la venta.
-- ---------------------------------------------------------------------------
create or replace function public.reject_sale_edit_request(p_request_id uuid, p_review_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_req public.sale_edit_requests;
  v_note text := btrim(coalesce(p_review_note, ''));
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;
  if v_note = '' then
    return jsonb_build_object('ok', false, 'code', 'REVIEW_NOTE_REQUIRED');
  end if;

  select * into v_req from public.sale_edit_requests where id = p_request_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'REQUEST_NOT_FOUND');
  end if;
  if v_req.status <> 'PENDING' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATUS');
  end if;

  update public.sale_edit_requests set
    status = 'REJECTED', reviewed_at = now(), reviewed_by = v_uid, review_note = v_note
  where id = p_request_id;

  return jsonb_build_object('ok', true, 'requestId', p_request_id);
end;
$$;
revoke all on function public.reject_sale_edit_request(uuid, text) from public, anon;
grant execute on function public.reject_sale_edit_request(uuid, text) to authenticated;

-- ===========================================================================
-- 10. Helpers internos de agregación — ADMIN-only, reutilizados por varias
--     RPCs del Centro de Aprobaciones (nunca una segunda calculadora: todo
--     llama a `sale_settlement_amounts`, ya autoritativa).
-- ===========================================================================
create or replace function public.admin_sold_sales_settlement()
returns table (
  sale_id uuid, seller_id uuid, seller_name text, sale_number text, buyer_name text,
  sale_total_cents bigint, collected_cents bigint, outstanding_cents bigint,
  ready_for_paid boolean, sold_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    s.id, s.seller_id, pr.full_name, s.sale_number,
    coalesce(nullif(btrim(coalesce(sp.first_name, '') || ' ' || coalesce(sp.last_name, '')), ''), 'Sin nombre'),
    coalesce(s.sale_total_cents, 0),
    st.collected_cents,
    greatest(0, coalesce(s.sale_total_cents, 0) - st.collected_cents),
    coalesce(st.all_covered, false) and coalesce(s.sale_total_cents, 0) > 0
      and st.collected_cents = coalesce(s.sale_total_cents, 0),
    s.sold_at
  from public.sales s
  join public.profiles pr on pr.id = s.seller_id
  left join public.sale_parties sp on sp.sale_id = s.id and sp.party_role = 'PRIMARY_BUYER'
  cross join lateral public.sale_settlement_amounts(s.id) st
  where s.status = 'SOLD' and s.operation_type = 'CUBA';
$$;
revoke all on function public.admin_sold_sales_settlement() from public, anon, authenticated;

create or replace function public.admin_actionable_financing_contracts()
returns table (
  allocation_id uuid, sale_id uuid, seller_id uuid, seller_name text, sale_number text, buyer_name text,
  provider_name text, plan_label text, gross_cents bigint, net_cents bigint,
  contract_id uuid, contract_status text, last_update timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    a.id, s.id, s.seller_id, pr.full_name, s.sale_number,
    coalesce(nullif(btrim(coalesce(sp.first_name, '') || ' ' || coalesce(sp.last_name, '')), ''), 'Sin nombre'),
    a.provider_name_snapshot, a.plan_label_snapshot, a.gross_amount_cents, a.net_amount_cents,
    c.id, coalesce(c.status, 'NOT_SENT'),
    coalesce(c.updated_at, s.sold_at, s.created_at)
  from public.sale_payment_allocations a
  join public.sales s on s.id = a.sale_id
  join public.profiles pr on pr.id = s.seller_id
  join public.payment_methods m on m.id = a.payment_method_id
  left join public.sale_parties sp on sp.sale_id = s.id and sp.party_role = 'PRIMARY_BUYER'
  left join public.sale_financing_contracts c on c.payment_allocation_id = a.id
  where m.method_type = 'FINANCING'
    and s.operation_type = 'CUBA'
    and s.status in ('PENDING', 'SOLD')
    and (c.id is null or c.status in ('SENT', 'SIGNED'));
$$;
revoke all on function public.admin_actionable_financing_contracts() from public, anon, authenticated;

-- ===========================================================================
-- 11. admin_approvals_counts — KPI de la parte superior de /admin/aprobaciones.
-- ===========================================================================
create or replace function public.admin_approvals_counts()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_ediciones int;
  v_contratos int;
  v_cobros    int;
  v_listas    int;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  select count(*) into v_ediciones from public.sale_edit_requests where status = 'PENDING';
  select count(*) into v_contratos from public.admin_actionable_financing_contracts();
  select count(*) into v_cobros from public.admin_sold_sales_settlement() where outstanding_cents > 0;
  select count(*) into v_listas from public.admin_sold_sales_settlement() where ready_for_paid;

  return jsonb_build_object(
    'ok', true,
    'totalPending', v_ediciones + v_contratos + v_cobros + v_listas,
    'edicionesSolicitadas', v_ediciones,
    'contratosRequierenAccion', v_contratos,
    'pendientesACobrar', v_cobros,
    'listasParaPagar', v_listas
  );
end;
$$;
revoke all on function public.admin_approvals_counts() from public, anon;
grant execute on function public.admin_approvals_counts() to authenticated;

-- ===========================================================================
-- 12. admin_approvals_todo — bandeja unificada (proyección server-side;
--     nunca se bajan las 4 tablas al navegador para mezclarlas en React).
-- ===========================================================================
create or replace function public.admin_approvals_todo(p_limit int default 30, p_offset int default 0)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_limit int := greatest(1, least(coalesce(p_limit, 30), 100));
  v_offset int := greatest(0, coalesce(p_offset, 0));
  v_result jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  with merged as (
    select
      'EDICION'::text as type, r.created_at as age_at,
      'Solicitud de edición · ' || coalesce(s.sale_number, 'sin número') as title,
      coalesce(nullif(btrim(coalesce(sp.first_name, '') || ' ' || coalesce(sp.last_name, '')), ''), 'Sin nombre') as subtitle,
      s.seller_id, pr.full_name as seller_name, s.id as sale_id, s.sale_number,
      r.id as entity_id, r.status as status, null::bigint as amount_cents,
      '/admin/aprobaciones/ediciones/' || r.id::text as action_url
    from public.sale_edit_requests r
    join public.sales s on s.id = r.sale_id
    join public.profiles pr on pr.id = s.seller_id
    left join public.sale_parties sp on sp.sale_id = s.id and sp.party_role = 'PRIMARY_BUYER'
    where r.status = 'PENDING'

    union all

    select
      'CONTRATO', c.last_update,
      'Contrato · ' || c.provider_name || ' · ' || coalesce(c.sale_number, 'sin número'),
      c.buyer_name,
      c.seller_id, c.seller_name, c.sale_id, c.sale_number,
      c.allocation_id, c.contract_status, c.net_cents,
      '/admin/ventas/' || c.sale_id::text
    from public.admin_actionable_financing_contracts() c

    union all

    select
      'COBRO', coalesce(x.sold_at, now()),
      'Pendiente a cobrar · ' || coalesce(x.sale_number, 'sin número'),
      x.buyer_name,
      x.seller_id, x.seller_name, x.sale_id, x.sale_number,
      x.sale_id, 'PENDING_COLLECTION', x.outstanding_cents,
      '/admin/ventas/' || x.sale_id::text
    from public.admin_sold_sales_settlement() x
    where x.outstanding_cents > 0

    union all

    select
      'LISTA_PARA_PAGAR', coalesce(x.sold_at, now()),
      'Lista para pagar · ' || coalesce(x.sale_number, 'sin número'),
      x.buyer_name,
      x.seller_id, x.seller_name, x.sale_id, x.sale_number,
      x.sale_id, 'READY', x.sale_total_cents,
      '/admin/ventas/' || x.sale_id::text
    from public.admin_sold_sales_settlement() x
    where x.ready_for_paid
  ),
  paged as (
    select * from merged order by age_at desc limit v_limit offset v_offset
  ),
  total as (
    select count(*) as n from merged
  )
  select jsonb_build_object(
    'ok', true,
    'total', (select n from total),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'type', p.type, 'createdAt', p.age_at, 'title', p.title, 'subtitle', p.subtitle,
        'sellerId', p.seller_id, 'sellerName', p.seller_name,
        'saleId', p.sale_id, 'saleNumber', p.sale_number,
        'entityId', p.entity_id, 'status', p.status, 'amountCents', p.amount_cents,
        'actionUrl', p.action_url
      ) order by p.age_at desc)
      from paged p
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;
revoke all on function public.admin_approvals_todo(int, int) from public, anon;
grant execute on function public.admin_approvals_todo(int, int) to authenticated;

-- ===========================================================================
-- 13. Ediciones — listado + detalle.
-- ===========================================================================
create or replace function public.admin_edit_requests_list(
  p_search text default null, p_status text default 'PENDING', p_limit int default 30, p_offset int default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_status text := coalesce(nullif(upper(btrim(p_status)), ''), 'PENDING');
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
    select r.*, s.sale_number, s.status as sale_status, pr.full_name as seller_name,
      coalesce(nullif(btrim(coalesce(sp.first_name, '') || ' ' || coalesce(sp.last_name, '')), ''), 'Sin nombre') as buyer_name
    from public.sale_edit_requests r
    join public.sales s on s.id = r.sale_id
    join public.profiles pr on pr.id = s.seller_id
    left join public.sale_parties sp on sp.sale_id = s.id and sp.party_role = 'PRIMARY_BUYER'
    where (v_status = 'ALL' or r.status = v_status)
      and (
        v_search is null
        or s.sale_number ilike '%' || v_search || '%'
        or pr.full_name ilike '%' || v_search || '%'
        or sp.first_name ilike '%' || v_search || '%'
        or sp.last_name ilike '%' || v_search || '%'
      )
  )
  select count(*) into v_total from base;

  with base as (
    select r.*, s.sale_number, s.status as sale_status, pr.full_name as seller_name,
      coalesce(nullif(btrim(coalesce(sp.first_name, '') || ' ' || coalesce(sp.last_name, '')), ''), 'Sin nombre') as buyer_name
    from public.sale_edit_requests r
    join public.sales s on s.id = r.sale_id
    join public.profiles pr on pr.id = s.seller_id
    left join public.sale_parties sp on sp.sale_id = s.id and sp.party_role = 'PRIMARY_BUYER'
    where (v_status = 'ALL' or r.status = v_status)
      and (
        v_search is null
        or s.sale_number ilike '%' || v_search || '%'
        or pr.full_name ilike '%' || v_search || '%'
        or sp.first_name ilike '%' || v_search || '%'
        or sp.last_name ilike '%' || v_search || '%'
      )
    order by r.created_at desc
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'ok', true, 'total', v_total,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'requestId', b.id, 'saleId', b.sale_id, 'saleNumber', b.sale_number, 'saleStatus', b.sale_status,
        'sellerName', b.seller_name, 'buyerName', b.buyer_name,
        'changeCount', jsonb_array_length(b.requested_changes),
        'reason', b.reason, 'status', b.status, 'createdAt', b.created_at,
        'reviewedAt', b.reviewed_at, 'reviewNote', b.review_note
      ) order by b.created_at desc)
      from base b
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;
revoke all on function public.admin_edit_requests_list(text, text, int, int) from public, anon;
grant execute on function public.admin_edit_requests_list(text, text, int, int) to authenticated;

create or replace function public.admin_edit_request_detail(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_req public.sale_edit_requests;
  v_flat jsonb;
  v_result jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  select * into v_req from public.sale_edit_requests where id = p_request_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'REQUEST_NOT_FOUND');
  end if;

  select flat into v_flat from public.sale_edit_snapshot(v_req.sale_id);

  select jsonb_build_object(
    'ok', true,
    'requestId', v_req.id,
    'status', v_req.status,
    'reason', v_req.reason,
    'createdAt', v_req.created_at,
    'reviewedAt', v_req.reviewed_at,
    'reviewedByName', (select full_name from public.profiles where id = v_req.reviewed_by),
    'reviewNote', v_req.review_note,
    'saleStatusAtRequest', v_req.sale_status_at_request,
    'sale', (select jsonb_build_object(
        'id', s.id, 'saleNumber', s.sale_number, 'status', s.status,
        'sellerId', s.seller_id, 'sellerName', pr.full_name,
        'buyerName', coalesce(nullif(btrim(coalesce(sp.first_name, '') || ' ' || coalesce(sp.last_name, '')), ''), 'Sin nombre')
      )
      from public.sales s
      join public.profiles pr on pr.id = s.seller_id
      left join public.sale_parties sp on sp.sale_id = s.id and sp.party_role = 'PRIMARY_BUYER'
      where s.id = v_req.sale_id),
    'changes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'path', c->>'path',
        'oldValue', c->>'oldValue',
        'newValue', c->>'newValue',
        'stillMatchesCurrent', coalesce(v_flat->>(c->>'path'), '') is not distinct from coalesce(c->>'oldValue', '')
      ))
      from jsonb_array_elements(v_req.requested_changes) c
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;
revoke all on function public.admin_edit_request_detail(uuid) from public, anon;
grant execute on function public.admin_edit_request_detail(uuid) to authenticated;

-- ===========================================================================
-- 14. Contratos / Cobros / Listas para pagar — listados paginados.
-- ===========================================================================
create or replace function public.admin_contracts_inbox(
  p_status text default 'ALL', p_seller_id uuid default null, p_search text default null,
  p_limit int default 30, p_offset int default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_status text := coalesce(nullif(upper(btrim(p_status)), ''), 'ALL');
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
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
    select * from public.admin_actionable_financing_contracts() c
    where (v_status = 'ALL' or c.contract_status = v_status)
      and (p_seller_id is null or c.seller_id = p_seller_id)
      and (v_search is null or c.sale_number ilike '%' || v_search || '%'
           or c.buyer_name ilike '%' || v_search || '%' or c.provider_name ilike '%' || v_search || '%')
  )
  select count(*) into v_total from base;

  with base as (
    select * from public.admin_actionable_financing_contracts() c
    where (v_status = 'ALL' or c.contract_status = v_status)
      and (p_seller_id is null or c.seller_id = p_seller_id)
      and (v_search is null or c.sale_number ilike '%' || v_search || '%'
           or c.buyer_name ilike '%' || v_search || '%' or c.provider_name ilike '%' || v_search || '%')
    order by c.last_update desc
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'ok', true, 'total', v_total,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'saleId', b.sale_id, 'saleNumber', b.sale_number, 'sellerName', b.seller_name, 'buyerName', b.buyer_name,
        'providerName', b.provider_name, 'planLabel', b.plan_label,
        'grossCents', b.gross_cents, 'netCents', b.net_cents,
        'contractStatus', b.contract_status, 'lastUpdate', b.last_update
      ) order by b.last_update desc)
      from base b
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;
revoke all on function public.admin_contracts_inbox(text, uuid, text, int, int) from public, anon;
grant execute on function public.admin_contracts_inbox(text, uuid, text, int, int) to authenticated;

create or replace function public.admin_collections_inbox(
  p_seller_id uuid default null, p_search text default null, p_limit int default 30, p_offset int default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
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
    select * from public.admin_sold_sales_settlement() x
    where x.outstanding_cents > 0
      and (p_seller_id is null or x.seller_id = p_seller_id)
      and (v_search is null or x.sale_number ilike '%' || v_search || '%' or x.buyer_name ilike '%' || v_search || '%')
  )
  select count(*) into v_total from base;

  with base as (
    select * from public.admin_sold_sales_settlement() x
    where x.outstanding_cents > 0
      and (p_seller_id is null or x.seller_id = p_seller_id)
      and (v_search is null or x.sale_number ilike '%' || v_search || '%' or x.buyer_name ilike '%' || v_search || '%')
    order by x.sold_at asc nulls last
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'ok', true, 'total', v_total,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'saleId', b.sale_id, 'saleNumber', b.sale_number, 'sellerName', b.seller_name, 'buyerName', b.buyer_name,
        'soldAt', b.sold_at, 'saleTotalCents', b.sale_total_cents,
        'collectedCents', b.collected_cents, 'outstandingCents', b.outstanding_cents
      ) order by b.sold_at asc nulls last)
      from base b
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;
revoke all on function public.admin_collections_inbox(uuid, text, int, int) from public, anon;
grant execute on function public.admin_collections_inbox(uuid, text, int, int) to authenticated;

create or replace function public.admin_ready_to_pay_inbox(
  p_seller_id uuid default null, p_search text default null, p_limit int default 30, p_offset int default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
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
    select * from public.admin_sold_sales_settlement() x
    where x.ready_for_paid
      and (p_seller_id is null or x.seller_id = p_seller_id)
      and (v_search is null or x.sale_number ilike '%' || v_search || '%' or x.buyer_name ilike '%' || v_search || '%')
  )
  select count(*) into v_total from base;

  with base as (
    select * from public.admin_sold_sales_settlement() x
    where x.ready_for_paid
      and (p_seller_id is null or x.seller_id = p_seller_id)
      and (v_search is null or x.sale_number ilike '%' || v_search || '%' or x.buyer_name ilike '%' || v_search || '%')
    order by x.sold_at asc nulls last
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'ok', true, 'total', v_total,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'saleId', b.sale_id, 'saleNumber', b.sale_number, 'sellerName', b.seller_name, 'buyerName', b.buyer_name,
        'soldAt', b.sold_at, 'saleTotalCents', b.sale_total_cents, 'collectedCents', b.collected_cents
      ) order by b.sold_at asc nulls last)
      from base b
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;
revoke all on function public.admin_ready_to_pay_inbox(uuid, text, int, int) from public, anon;
grant execute on function public.admin_ready_to_pay_inbox(uuid, text, int, int) to authenticated;
