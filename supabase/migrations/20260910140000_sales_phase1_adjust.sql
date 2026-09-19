-- ===========================================================================
-- Fase 1 del backend de ventas CUBA — ajustes de esquema.
--
-- - sale_documents: `doc_slot` combinado -> `subject_type` + `side` separados,
--   con FK a la parte / al receptor y `uploaded_by`.
-- - sale_deliveries: `reference` -> `pickup_reference`, + `delivery_notes`.
-- - sale_status_history: + `reason`.
-- - RPCs actualizadas: save_cuba_sale_draft, get_cuba_sale_draft,
--   record_sale_document (nueva firma) + remove_sale_document (nueva).
--
-- Tablas `sales` / `sale_documents` están vacías: los ALTER son seguros.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- sale_documents
-- ---------------------------------------------------------------------------
alter table public.sale_documents drop column doc_slot;        -- arrastra su check + unique
alter table public.sale_documents drop column storage_bucket;  -- siempre 'sale-documents'
alter table public.sale_documents rename column byte_size to file_size_bytes;

alter table public.sale_documents
  add column subject_type text not null,
  add column side         text not null,
  add column party_id     uuid references public.sale_parties (id) on delete set null,
  add column recipient_id uuid references public.sale_cuba_recipients (id) on delete set null,
  add column uploaded_by   uuid references public.profiles (id) on delete set null,
  add column extraction_metadata jsonb not null default '{}'::jsonb;

alter table public.sale_documents
  add constraint sale_documents_subject_type_check
    check (subject_type in ('BUYER', 'CO_BUYER', 'CUBA_RECIPIENT')),
  add constraint sale_documents_side_check
    check (side in ('FRONT', 'BACK')),
  add constraint sale_documents_subject_side_key
    unique (sale_id, subject_type, side);

comment on column public.sale_documents.extraction_metadata is
  'Metadatos opcionales de la lectura local del documento. Los datos de identidad viven en tablas relacionales, no aquí.';

-- ---------------------------------------------------------------------------
-- sale_deliveries
-- ---------------------------------------------------------------------------
alter table public.sale_deliveries rename column reference to pickup_reference;
alter table public.sale_deliveries add column delivery_notes text;

-- ---------------------------------------------------------------------------
-- sale_status_history
-- ---------------------------------------------------------------------------
alter table public.sale_status_history add column reason text;

-- ===========================================================================
-- RPCs
-- ===========================================================================

-- ---- save_cuba_sale_draft (bloque de entrega actualizado) -----------------
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

  -- unidades — reemplazo completo; snapshots DERIVADOS de la base
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
          and pv.product_id = v_prod.id;
      if v_variant_label is null then
        raise exception 'la variante no pertenece al producto en la unidad %', v_pos + 1;
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

  -- extras — reemplazo completo
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

  return jsonb_build_object(
    'saleId', p_sale_id,
    'updatedAt', (select updated_at from public.sales where id = p_sale_id),
    'ok', true);
end;
$$;

-- ---- get_cuba_sale_draft (bloque de documentos actualizado) --------------
create or replace function public.get_cuba_sale_draft(p_sale_id uuid)
returns jsonb
language sql
security invoker
set search_path = public
stable
as $$
  select jsonb_build_object(
    'sale', to_jsonb(s.*),
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
                          from public.sale_documents sd where sd.sale_id = s.id), '[]'::jsonb)
  )
  from public.sales s
  where s.id = p_sale_id;
$$;

-- ---- record_sale_document (nueva firma) ---------------------------------
drop function if exists public.record_sale_document(uuid, text, text, text, bigint);

create or replace function public.record_sale_document(
  p_sale_id uuid, p_subject_type text, p_side text, p_storage_path text,
  p_mime_type text default null, p_file_size_bytes bigint default null)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_party_id uuid;
  v_recipient_id uuid;
begin
  if p_subject_type = 'BUYER' then
    select id into v_party_id from public.sale_parties
      where sale_id = p_sale_id and party_role = 'PRIMARY_BUYER';
  elsif p_subject_type = 'CO_BUYER' then
    select id into v_party_id from public.sale_parties
      where sale_id = p_sale_id and party_role = 'CO_BUYER';
  elsif p_subject_type = 'CUBA_RECIPIENT' then
    select id into v_recipient_id from public.sale_cuba_recipients
      where sale_id = p_sale_id;
  end if;

  insert into public.sale_documents (
    sale_id, subject_type, side, party_id, recipient_id, storage_path,
    mime_type, file_size_bytes, uploaded_by)
  values (
    p_sale_id, p_subject_type, p_side, v_party_id, v_recipient_id, p_storage_path,
    p_mime_type, p_file_size_bytes, auth.uid())
  on conflict (sale_id, subject_type, side) do update set
    party_id = excluded.party_id,
    recipient_id = excluded.recipient_id,
    storage_path = excluded.storage_path,
    mime_type = excluded.mime_type,
    file_size_bytes = excluded.file_size_bytes,
    uploaded_by = excluded.uploaded_by;
end;
$$;

create or replace function public.remove_sale_document(
  p_sale_id uuid, p_subject_type text, p_side text)
returns void
language sql
security invoker
set search_path = public
as $$
  delete from public.sale_documents
  where sale_id = p_sale_id
    and subject_type = p_subject_type
    and side = p_side;
$$;

grant execute on function public.record_sale_document(uuid, text, text, text, text, bigint) to authenticated;
grant execute on function public.remove_sale_document(uuid, text, text) to authenticated;
