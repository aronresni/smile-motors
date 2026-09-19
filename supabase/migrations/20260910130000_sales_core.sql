-- ===========================================================================
-- Backend relacional de ventas (borrador de venta CUBA).
--
-- - La propiedad de la venta (seller_id) la fija SIEMPRE el servidor a
--   auth.uid(); el frontend nunca la controla.
-- - Los snapshots de producto se derivan en el servidor desde la base, no del
--   payload del navegador.
-- - Nada de comisiones/pagos/financiación/liquidación aquí.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- sales
-- ---------------------------------------------------------------------------
create table public.sales (
  id               uuid primary key default gen_random_uuid(),
  seller_id        uuid not null references public.profiles (id) on delete restrict,
  operation_type   text not null check (operation_type in ('CUBA', 'USA', 'LOCAL')),
  status           text not null default 'DRAFT'
                   check (status in ('DRAFT', 'PENDING_REVIEW', 'APPROVED',
                                     'REJECTED', 'PROCESSING', 'COMPLETED', 'CANCELLED')),
  sale_date        date,
  share_commission boolean not null default false,
  internal_notes   text,
  currency         text not null default 'USD',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index sales_seller_idx on public.sales (seller_id);
create index sales_status_idx on public.sales (status);

-- Propiedad inmutable desde el cliente: seller_id = auth.uid() en insert;
-- cualquier intento de cambiarlo en update se ignora.
create or replace function public.enforce_sale_ownership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.seller_id := auth.uid();
  elsif tg_op = 'UPDATE' then
    new.seller_id := old.seller_id;
  end if;
  return new;
end;
$$;

drop trigger if exists sales_enforce_ownership on public.sales;
create trigger sales_enforce_ownership
  before insert or update on public.sales
  for each row execute function public.enforce_sale_ownership();

create trigger sales_set_updated_at
  before update on public.sales
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- sale_status_history  (NULL -> DRAFT al crear)
-- ---------------------------------------------------------------------------
create table public.sale_status_history (
  id          uuid primary key default gen_random_uuid(),
  sale_id     uuid not null references public.sales (id) on delete cascade,
  from_status text,
  to_status   text not null,
  changed_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index sale_status_history_sale_idx on public.sale_status_history (sale_id);

create or replace function public.log_sale_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.sale_status_history (sale_id, from_status, to_status, changed_by)
    values (new.id, null, new.status, auth.uid());
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into public.sale_status_history (sale_id, from_status, to_status, changed_by)
    values (new.id, old.status, new.status, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists sales_log_status on public.sales;
create trigger sales_log_status
  after insert or update on public.sales
  for each row execute function public.log_sale_status();

-- ---------------------------------------------------------------------------
-- sale_parties  (PRIMARY_BUYER, opcional CO_BUYER)
-- ---------------------------------------------------------------------------
create table public.sale_parties (
  id                  uuid primary key default gen_random_uuid(),
  sale_id             uuid not null references public.sales (id) on delete cascade,
  party_role          text not null check (party_role in ('PRIMARY_BUYER', 'CO_BUYER')),
  first_name          text,
  last_name           text,
  date_of_birth       date,
  document_number     text,
  document_expiration date,
  phone               text,
  email               text,
  address_line1       text,
  address_line2       text,
  city                text,
  state               text,
  postal_code         text,
  country_code        text default 'US',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (sale_id, party_role)
);
create index sale_parties_sale_idx on public.sale_parties (sale_id);
create trigger sale_parties_set_updated_at
  before update on public.sale_parties
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- sale_units  (con snapshots históricos)
-- ---------------------------------------------------------------------------
create table public.sale_units (
  id                        uuid primary key default gen_random_uuid(),
  sale_id                   uuid not null references public.sales (id) on delete cascade,
  position                  integer not null default 0,
  product_id                uuid not null references public.products (id) on delete restrict,
  product_variant_id        uuid references public.product_variants (id) on delete set null,
  inventory_unit_id         uuid references public.inventory_units (id) on delete set null,
  product_name_snapshot     text not null,
  brand_snapshot            text,
  variant_snapshot          text,
  list_price_cents_snapshot bigint,
  cuba_total_cents_snapshot bigint,
  agreed_price_cents        bigint not null default 0,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create index sale_units_sale_idx on public.sale_units (sale_id);
create trigger sale_units_set_updated_at
  before update on public.sale_units
  for each row execute function public.set_updated_at();

comment on column public.sale_units.list_price_cents_snapshot is
  'Copia del precio del producto al guardar. Una venta antigua NO debe recalcularse contra el precio actual del catálogo.';

-- ---------------------------------------------------------------------------
-- sale_extras
-- ---------------------------------------------------------------------------
create table public.sale_extras (
  id               uuid primary key default gen_random_uuid(),
  sale_id          uuid not null references public.sales (id) on delete cascade,
  sale_unit_id     uuid references public.sale_units (id) on delete cascade,
  description      text,
  quantity         integer not null default 1,
  unit_price_cents bigint not null default 0,
  position         integer not null default 0,
  created_at       timestamptz not null default now()
);
create index sale_extras_sale_idx on public.sale_extras (sale_id);

-- ---------------------------------------------------------------------------
-- sale_cuba_recipients  (persona DISTINTA del comprador)
-- ---------------------------------------------------------------------------
create table public.sale_cuba_recipients (
  id               uuid primary key default gen_random_uuid(),
  sale_id          uuid not null unique references public.sales (id) on delete cascade,
  full_name        text,
  identity_number  text,
  date_of_birth    date,
  identity_address text,                                 -- dirección impresa en el CI (referencia)
  delivery_address text,
  municipality     text,
  province         text,
  primary_phone    text,
  secondary_phone  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger sale_cuba_recipients_set_updated_at
  before update on public.sale_cuba_recipients
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- sale_deliveries  (un único método, sin flags contradictorios)
-- ---------------------------------------------------------------------------
create table public.sale_deliveries (
  id         uuid primary key default gen_random_uuid(),
  sale_id    uuid not null unique references public.sales (id) on delete cascade,
  method     text check (method in ('HOME_DELIVERY', 'PICKUP_POINT')),
  reference  text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger sale_deliveries_set_updated_at
  before update on public.sale_deliveries
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- sale_documents  (SOLO metadatos; los archivos van a Storage privado)
-- ---------------------------------------------------------------------------
create table public.sale_documents (
  id             uuid primary key default gen_random_uuid(),
  sale_id        uuid not null references public.sales (id) on delete cascade,
  doc_slot       text not null check (doc_slot in (
                   'BUYER_FRONT', 'BUYER_BACK',
                   'CO_BUYER_FRONT', 'CO_BUYER_BACK',
                   'RECIPIENT_FRONT', 'RECIPIENT_BACK')),
  storage_bucket text not null default 'sale-documents',
  storage_path   text not null,
  mime_type      text,
  byte_size      bigint,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (sale_id, doc_slot)
);
create index sale_documents_sale_idx on public.sale_documents (sale_id);
create trigger sale_documents_set_updated_at
  before update on public.sale_documents
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- Helpers de propiedad para RLS de tablas hijas
-- ===========================================================================
create or replace function public.sale_is_own(p_sale_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.sales s
    where s.id = p_sale_id and s.seller_id = auth.uid()
  );
$$;

create or replace function public.sale_is_own_draft(p_sale_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.sales s
    where s.id = p_sale_id
      and s.seller_id = auth.uid()
      and s.status = 'DRAFT'
  );
$$;

-- ===========================================================================
-- RLS
-- ===========================================================================
alter table public.sales                enable row level security;
alter table public.sale_status_history  enable row level security;
alter table public.sale_parties         enable row level security;
alter table public.sale_units           enable row level security;
alter table public.sale_extras          enable row level security;
alter table public.sale_cuba_recipients enable row level security;
alter table public.sale_deliveries      enable row level security;
alter table public.sale_documents       enable row level security;

grant select, insert, update, delete on
  public.sales, public.sale_parties, public.sale_units, public.sale_extras,
  public.sale_cuba_recipients, public.sale_deliveries, public.sale_documents
  to authenticated;
grant select on public.sale_status_history to authenticated;

-- sales -----------------------------------------------------------------------
create policy sales_select_own on public.sales
  for select to authenticated
  using (seller_id = auth.uid() or public.is_admin());

create policy sales_insert_own on public.sales
  for insert to authenticated
  with check (
    seller_id = auth.uid()
    and status = 'DRAFT'
    and public.user_role() is not null
  );

create policy sales_update_own_draft on public.sales
  for update to authenticated
  using (seller_id = auth.uid() and status = 'DRAFT')
  with check (seller_id = auth.uid() and status = 'DRAFT');

-- (sin política de DELETE para vendedores; los borradores permanecen)

-- sale_status_history: solo lectura de las ventas propias
create policy sale_status_history_select on public.sale_status_history
  for select to authenticated
  using (public.sale_is_own(sale_id) or public.is_admin());

-- helper macro (manual) para cada tabla hija:
--   SELECT  -> venta propia (cualquier estado)
--   INSERT/UPDATE/DELETE -> venta propia en DRAFT
create policy sale_parties_select on public.sale_parties
  for select to authenticated using (public.sale_is_own(sale_id) or public.is_admin());
create policy sale_parties_write on public.sale_parties
  for all to authenticated
  using (public.sale_is_own_draft(sale_id)) with check (public.sale_is_own_draft(sale_id));

create policy sale_units_select on public.sale_units
  for select to authenticated using (public.sale_is_own(sale_id) or public.is_admin());
create policy sale_units_write on public.sale_units
  for all to authenticated
  using (public.sale_is_own_draft(sale_id)) with check (public.sale_is_own_draft(sale_id));

create policy sale_extras_select on public.sale_extras
  for select to authenticated using (public.sale_is_own(sale_id) or public.is_admin());
create policy sale_extras_write on public.sale_extras
  for all to authenticated
  using (public.sale_is_own_draft(sale_id)) with check (public.sale_is_own_draft(sale_id));

create policy sale_cuba_recipients_select on public.sale_cuba_recipients
  for select to authenticated using (public.sale_is_own(sale_id) or public.is_admin());
create policy sale_cuba_recipients_write on public.sale_cuba_recipients
  for all to authenticated
  using (public.sale_is_own_draft(sale_id)) with check (public.sale_is_own_draft(sale_id));

create policy sale_deliveries_select on public.sale_deliveries
  for select to authenticated using (public.sale_is_own(sale_id) or public.is_admin());
create policy sale_deliveries_write on public.sale_deliveries
  for all to authenticated
  using (public.sale_is_own_draft(sale_id)) with check (public.sale_is_own_draft(sale_id));

create policy sale_documents_select on public.sale_documents
  for select to authenticated using (public.sale_is_own(sale_id) or public.is_admin());
create policy sale_documents_write on public.sale_documents
  for all to authenticated
  using (public.sale_is_own_draft(sale_id)) with check (public.sale_is_own_draft(sale_id));

-- ===========================================================================
-- RPCs (SECURITY INVOKER: la RLS de arriba sigue aplicando como el usuario)
-- ===========================================================================

-- Crear borrador. Devuelve el UUID de la venta.
create or replace function public.create_sale_draft(p_operation_type text default 'CUBA')
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_operation_type not in ('CUBA', 'USA', 'LOCAL') then
    raise exception 'operación inválida';
  end if;

  insert into public.sales (seller_id, operation_type, status)
  values (auth.uid(), p_operation_type, 'DRAFT')   -- el trigger también fuerza seller_id
  returning id into v_id;

  return v_id;
end;
$$;

-- Guardar borrador CUBA: sincroniza tablas relacionales de forma atómica.
-- El payload es SOLO transporte; NUNCA se guarda como jsonb.
-- Los snapshots de producto se DERIVAN aquí desde la base.
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

  -- 1) cabecera
  update public.sales set
    sale_date        = nullif(p_payload->>'saleDate', '')::date,
    share_commission = coalesce((p_payload->>'shareCommission')::boolean, false),
    internal_notes   = nullif(p_payload->>'internalNotes', '')
  where id = p_sale_id;

  -- 2) comprador principal
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

  -- 3) co-comprador (opcional)
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

  -- 4) unidades — se reemplazan por completo; snapshots DERIVADOS de la base
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

  -- 5) extras — reemplazo completo
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

  -- 6) destinatario en Cuba
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

  -- 7) entrega
  insert into public.sale_deliveries (sale_id, method, reference)
  values (
    p_sale_id,
    nullif(p_payload#>>'{delivery,method}', ''),
    nullif(p_payload#>>'{delivery,reference}', ''))
  on conflict (sale_id) do update set
    method = excluded.method, reference = excluded.reference;

  return jsonb_build_object('saleId', p_sale_id, 'ok', true);
end;
$$;

-- Cargar borrador completo para reconstruir el formulario.
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
                             'docSlot', sd.doc_slot, 'storagePath', sd.storage_path,
                             'mimeType', sd.mime_type, 'byteSize', sd.byte_size))
                          from public.sale_documents sd where sd.sale_id = s.id), '[]'::jsonb)
  )
  from public.sales s
  where s.id = p_sale_id;   -- RLS restringe a ventas propias / admin
$$;

-- Registrar/actualizar el metadato de un documento (tras subir a Storage).
create or replace function public.record_sale_document(
  p_sale_id uuid, p_doc_slot text, p_storage_path text,
  p_mime_type text default null, p_byte_size bigint default null)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  insert into public.sale_documents (
    sale_id, doc_slot, storage_bucket, storage_path, mime_type, byte_size)
  values (p_sale_id, p_doc_slot, 'sale-documents', p_storage_path, p_mime_type, p_byte_size)
  on conflict (sale_id, doc_slot) do update set
    storage_path = excluded.storage_path,
    mime_type = excluded.mime_type,
    byte_size = excluded.byte_size;
end;
$$;

grant execute on function public.create_sale_draft(text) to authenticated;
grant execute on function public.save_cuba_sale_draft(uuid, jsonb) to authenticated;
grant execute on function public.get_cuba_sale_draft(uuid) to authenticated;
grant execute on function public.record_sale_document(uuid, text, text, text, bigint) to authenticated;

-- ===========================================================================
-- Storage privado para documentos de venta
-- ===========================================================================
insert into storage.buckets (id, name, public)
values ('sale-documents', 'sale-documents', false)
on conflict (id) do nothing;

-- Ruta: {sellerId}/{saleId}/(buyer|co-buyer|recipient)/(front|back).jpg
-- El primer segmento debe ser el uid del usuario autenticado.
drop policy if exists "sale-documents read own" on storage.objects;
create policy "sale-documents read own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'sale-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "sale-documents insert own" on storage.objects;
create policy "sale-documents insert own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'sale-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "sale-documents update own" on storage.objects;
create policy "sale-documents update own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'sale-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'sale-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "sale-documents delete own" on storage.objects;
create policy "sale-documents delete own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'sale-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
