-- ===========================================================================
-- Confirmación automática de venta CUBA: DRAFT -> CONFIRMED (sin aprobación
-- de admin, sin depender de PENDING_REVIEW).
--
-- - Añade CONFIRMED al check de estado (PENDING_REVIEW permanece disponible).
-- - Campos de confirmación en `sales` + `sale_units.tracking_code`.
-- - Secuencias concurrency-safe para número de venta y tracking.
-- - RPC atómica `confirm_cuba_sale` (SECURITY DEFINER: la RLS de UPDATE de
--   `sales` prohíbe correctamente cambiar el estado desde el cliente, así que
--   la transición debe pasar SÍ o SÍ por esta función, que valida propiedad,
--   perfil activo y las reglas de negocio antes de mutar nada).
-- - `get_cuba_sale_draft` amplía su salida con el nombre del vendedor.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Estado CONFIRMED
-- ---------------------------------------------------------------------------
alter table public.sales drop constraint if exists sales_status_check;
alter table public.sales add constraint sales_status_check
  check (status in ('DRAFT', 'PENDING_REVIEW', 'CONFIRMED', 'APPROVED',
                    'REJECTED', 'PROCESSING', 'COMPLETED', 'CANCELLED'));

-- ---------------------------------------------------------------------------
-- 2. Campos de confirmación
-- ---------------------------------------------------------------------------
alter table public.sales
  add column if not exists sale_number          text unique,
  add column if not exists confirmed_at         timestamptz,
  add column if not exists confirmed_by         uuid references public.profiles (id) on delete set null,
  add column if not exists units_total_cents    bigint,
  add column if not exists extras_total_cents   bigint,
  add column if not exists delivery_total_cents bigint,
  add column if not exists sale_total_cents     bigint;

alter table public.sale_units
  add column if not exists tracking_code text unique;

comment on column public.sales.sale_number is 'Generado en la confirmación. Nunca lo aporta el navegador.';
comment on column public.sale_units.tracking_code is 'Código de seguimiento permanente por unidad. Se genera al confirmar.';

-- ---------------------------------------------------------------------------
-- 3. Secuencias concurrency-safe
-- ---------------------------------------------------------------------------
create sequence if not exists public.sale_number_seq;
create sequence if not exists public.sale_unit_tracking_seq;

-- ---------------------------------------------------------------------------
-- 4. get_cuba_sale_draft — + nombre del vendedor (sirve para draft y confirmada)
-- ---------------------------------------------------------------------------
create or replace function public.get_cuba_sale_draft(p_sale_id uuid)
returns jsonb
language sql
security invoker
set search_path = public
stable
as $$
  select jsonb_build_object(
    'sale', to_jsonb(s.*),
    'seller', (select jsonb_build_object('id', pr.id, 'fullName', pr.full_name, 'email', pr.email)
               from public.profiles pr where pr.id = s.seller_id),
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
  where s.id = p_sale_id;   -- RLS: solo ventas propias / admin
$$;

-- ---------------------------------------------------------------------------
-- 5. confirm_cuba_sale — atómica
-- ---------------------------------------------------------------------------
create or replace function public.confirm_cuba_sale(p_sale_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_sale       public.sales;
  v_buyer      public.sale_parties;
  v_recipient  public.sale_cuba_recipients;
  v_delivery   public.sale_deliveries;
  v_errors     text[] := array[]::text[];
  v_unit       record;
  v_units_total    bigint := 0;
  v_extras_total   bigint := 0;
  v_delivery_total bigint := 0;
  v_sale_total     bigint := 0;
  v_unit_count int := 0;
  v_number     text;
  v_year       text := to_char(current_date, 'YYYY');
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

  -- Idempotencia: ya confirmada -> devolver lo existente
  if v_sale.status = 'CONFIRMED' then
    return jsonb_build_object(
      'ok', true, 'alreadyConfirmed', true,
      'saleId', v_sale.id, 'saleNumber', v_sale.sale_number,
      'saleTotalCents', v_sale.sale_total_cents);
  end if;
  if v_sale.status <> 'DRAFT' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATUS');
  end if;

  ---------------------------------------------------------------------------
  -- Validación autoritativa (contra datos persistidos)
  ---------------------------------------------------------------------------
  select * into v_buyer from public.sale_parties
    where sale_id = p_sale_id and party_role = 'PRIMARY_BUYER';
  if not found then
    v_errors := v_errors || 'BUYER_MISSING';
  else
    if coalesce(btrim(v_buyer.first_name), '') = '' then v_errors := v_errors || 'BUYER_FIRST_NAME_MISSING'; end if;
    if coalesce(btrim(v_buyer.last_name), '') = '' then v_errors := v_errors || 'BUYER_LAST_NAME_MISSING'; end if;
    if coalesce(btrim(v_buyer.document_number), '') = '' then v_errors := v_errors || 'BUYER_DOCUMENT_NUMBER_MISSING'; end if;
    if coalesce(btrim(v_buyer.phone), '') = '' then v_errors := v_errors || 'BUYER_PHONE_MISSING'; end if;
  end if;
  if not exists (select 1 from public.sale_documents where sale_id = p_sale_id and subject_type = 'BUYER' and side = 'FRONT') then
    v_errors := v_errors || 'BUYER_DOCUMENT_FRONT_MISSING';
  end if;
  if not exists (select 1 from public.sale_documents where sale_id = p_sale_id and subject_type = 'BUYER' and side = 'BACK') then
    v_errors := v_errors || 'BUYER_DOCUMENT_BACK_MISSING';
  end if;

  -- Unidades
  select count(*) into v_unit_count from public.sale_units where sale_id = p_sale_id;
  if v_unit_count = 0 then
    v_errors := v_errors || 'NO_SALE_UNITS';
  else
    for v_unit in select su.* from public.sale_units su where su.sale_id = p_sale_id loop
      if v_unit.product_id is null then
        v_errors := v_errors || 'UNIT_PRODUCT_MISSING';
      elsif not exists (select 1 from public.products p where p.id = v_unit.product_id and p.is_active) then
        v_errors := v_errors || 'UNIT_PRODUCT_INACTIVE';
      elsif v_unit.product_variant_id is not null
        and not exists (select 1 from public.product_variants pv
                        where pv.id = v_unit.product_variant_id and pv.product_id = v_unit.product_id) then
        v_errors := v_errors || 'UNIT_VARIANT_MISMATCH';
      end if;
      if coalesce(v_unit.agreed_price_cents, 0) <= 0 then
        v_errors := v_errors || 'UNIT_AGREED_PRICE_INVALID';
      end if;
    end loop;
  end if;

  -- Destinatario en Cuba
  select * into v_recipient from public.sale_cuba_recipients where sale_id = p_sale_id;
  if not found then
    v_errors := v_errors || 'RECIPIENT_MISSING';
  else
    if coalesce(btrim(v_recipient.full_name), '') = '' then v_errors := v_errors || 'RECIPIENT_FULL_NAME_MISSING'; end if;
    if coalesce(btrim(v_recipient.identity_number), '') = '' then v_errors := v_errors || 'RECIPIENT_IDENTITY_NUMBER_MISSING'; end if;
    if coalesce(btrim(v_recipient.delivery_address), '') = '' then v_errors := v_errors || 'RECIPIENT_DELIVERY_ADDRESS_MISSING'; end if;
    if coalesce(btrim(v_recipient.municipality), '') = '' then v_errors := v_errors || 'RECIPIENT_MUNICIPALITY_MISSING'; end if;
    if coalesce(btrim(v_recipient.province), '') = '' then v_errors := v_errors || 'RECIPIENT_PROVINCE_MISSING'; end if;
    if coalesce(btrim(v_recipient.primary_phone), '') = '' then v_errors := v_errors || 'RECIPIENT_PRIMARY_PHONE_MISSING'; end if;
  end if;
  if not exists (select 1 from public.sale_documents where sale_id = p_sale_id and subject_type = 'CUBA_RECIPIENT' and side = 'FRONT') then
    v_errors := v_errors || 'RECIPIENT_DOCUMENT_FRONT_MISSING';
  end if;
  if not exists (select 1 from public.sale_documents where sale_id = p_sale_id and subject_type = 'CUBA_RECIPIENT' and side = 'BACK') then
    v_errors := v_errors || 'RECIPIENT_DOCUMENT_BACK_MISSING';
  end if;

  -- Entrega
  select * into v_delivery from public.sale_deliveries where sale_id = p_sale_id;
  if not found then
    v_errors := v_errors || 'DELIVERY_MISSING';
  elsif coalesce(btrim(v_delivery.method), '') = '' then
    v_errors := v_errors || 'DELIVERY_METHOD_MISSING';
  end if;
  -- Nota: el esquema actual del frontend NO exige pickup_reference para
  -- PICKUP_POINT, así que aquí tampoco se exige (consistencia).

  if array_length(v_errors, 1) is not null then
    return jsonb_build_object('ok', false, 'code', 'VALIDATION_FAILED', 'errors', to_jsonb(v_errors));
  end if;

  ---------------------------------------------------------------------------
  -- Totales autoritativos
  ---------------------------------------------------------------------------
  select coalesce(sum(agreed_price_cents), 0) into v_units_total
    from public.sale_units where sale_id = p_sale_id;
  select coalesce(sum(greatest(1, quantity) * greatest(0, unit_price_cents)), 0) into v_extras_total
    from public.sale_extras where sale_id = p_sale_id;
  v_delivery_total := 0; -- no hay motor de precios de envío todavía
  v_sale_total := v_units_total + v_extras_total + v_delivery_total;

  ---------------------------------------------------------------------------
  -- Número de venta (si falta)
  ---------------------------------------------------------------------------
  v_number := v_sale.sale_number;
  if v_number is null then
    v_number := 'VTA-' || v_year || '-' || lpad(nextval('public.sale_number_seq')::text, 6, '0');
  end if;

  ---------------------------------------------------------------------------
  -- Tracking por unidad (solo las que no lo tengan)
  ---------------------------------------------------------------------------
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

  ---------------------------------------------------------------------------
  -- Transición atómica
  ---------------------------------------------------------------------------
  update public.sales set
    status               = 'CONFIRMED',
    confirmed_at         = now(),
    confirmed_by         = v_uid,
    sale_number          = v_number,
    units_total_cents    = v_units_total,
    extras_total_cents   = v_extras_total,
    delivery_total_cents = v_delivery_total,
    sale_total_cents     = v_sale_total
  where id = p_sale_id;
  -- El trigger log_sale_status registra DRAFT -> CONFIRMED (changed_by = auth.uid()).

  return jsonb_build_object(
    'ok', true,
    'saleId', p_sale_id,
    'saleNumber', v_number,
    'status', 'CONFIRMED',
    'unitsTotalCents', v_units_total,
    'extrasTotalCents', v_extras_total,
    'deliveryTotalCents', v_delivery_total,
    'saleTotalCents', v_sale_total,
    'unitCount', v_unit_count);
end;
$$;

revoke all on function public.confirm_cuba_sale(uuid) from public, anon;
grant execute on function public.confirm_cuba_sale(uuid) to authenticated;
