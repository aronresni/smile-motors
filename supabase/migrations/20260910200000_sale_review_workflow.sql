-- ===========================================================================
-- Flujo comercial DRAFT → PENDING → SOLD → PAID + contratos de financiación.
--
-- - Reemplaza la confirmación automática (DRAFT→CONFIRMED) por un flujo de
--   revisión: el vendedor SOLICITA revisión (DRAFT→PENDING); un ADMIN
--   aprueba (PENDING→SOLD) o devuelve a borrador (PENDING→DRAFT, con motivo).
--   PAID se determina server-side cuando la liquidación queda completa.
-- - `sales.status` (comercial), `sale_financing_contracts.status` (contrato
--   de financiera: SENT/SIGNED/ACCREDITED) y `sale_payment_allocations`
--   (bruto/fee/neto + `settlement_status` para pagos directos) son máquinas
--   de estado DISTINTAS — nunca se mezclan en una sola columna.
-- - `CONFIRMED` (dato real existente) se migra a `SOLD` de forma segura.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. Verificación previa: no debe haber estados fuera de lo esperado.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from public.sales
    where status not in ('DRAFT', 'CONFIRMED', 'CANCELLED')
  ) then
    raise exception 'Hay ventas con un status inesperado antes de migrar; revisar manualmente.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Columnas de `sales` — vocabulario nuevo
-- ---------------------------------------------------------------------------
alter table public.sales rename column confirmed_at to sold_at;
alter table public.sales rename column confirmed_by to sold_by;

alter table public.sales
  add column if not exists review_requested_at timestamptz,
  add column if not exists review_requested_by uuid references public.profiles (id) on delete set null,
  add column if not exists paid_at              timestamptz,
  add column if not exists paid_by              uuid references public.profiles (id) on delete set null;

comment on column public.sales.sold_at is 'Cuándo un ADMIN aprobó la revisión (PENDING → SOLD). Antes `confirmed_at`.';
comment on column public.sales.paid_at is 'Cuándo la liquidación quedó completa (SOLD → PAID).';

-- ---------------------------------------------------------------------------
-- 2. Migración segura de datos existentes: CONFIRMED → SOLD
-- ---------------------------------------------------------------------------
-- El check anterior no admite 'SOLD'; se retira ANTES de escribir el nuevo
-- valor y se reinstala ya endurecido al vocabulario nuevo.
alter table public.sales drop constraint if exists sales_status_check;

update public.sales set status = 'SOLD' where status = 'CONFIRMED';
-- Nunca se asume CONFIRMED = PAID: el estado de liquidación se recalculará
-- server-side (ver `recompute_sale_paid_status`) a partir de datos reales.

alter table public.sales add constraint sales_status_check
  check (status in ('DRAFT', 'PENDING', 'SOLD', 'PAID', 'CANCELLED'));

-- ---------------------------------------------------------------------------
-- 3. `log_sale_status` — solo el alta (NULL→DRAFT) se audita por trigger; toda
--    transición de estado en adelante pasa por una RPC que inserta su propia
--    fila de historial (con motivo cuando aplica). Evita filas duplicadas o
--    sin motivo.
-- ---------------------------------------------------------------------------
drop trigger if exists sales_log_status on public.sales;
create trigger sales_log_status
  after insert on public.sales
  for each row execute function public.log_sale_status();

-- ---------------------------------------------------------------------------
-- 4. Liquidación de pagos directos (CARD/ZELLE/INTERNAL): estado operativo
--    propio, SIN forzar el ciclo de financieras (SENT/SIGNED/ACCREDITED).
-- ---------------------------------------------------------------------------
alter table public.sale_payment_allocations
  add column if not exists settlement_status text not null default 'PENDING'
    check (settlement_status in ('PENDING', 'SETTLED')),
  add column if not exists settled_at timestamptz,
  add column if not exists settled_by uuid references public.profiles (id) on delete set null;

-- ---------------------------------------------------------------------------
-- 5. Contratos de financiación (una venta puede tener varios)
-- ---------------------------------------------------------------------------
create table public.sale_financing_contracts (
  id                       uuid primary key default gen_random_uuid(),
  sale_id                  uuid not null references public.sales (id) on delete cascade,
  payment_allocation_id    uuid not null unique
                           references public.sale_payment_allocations (id) on delete cascade,
  payment_method_id        uuid not null references public.payment_methods (id) on delete restrict,
  status                   text not null check (status in ('SENT', 'SIGNED', 'ACCREDITED')),
  gross_amount_cents       bigint not null,
  fee_amount_cents         bigint not null,
  net_amount_cents         bigint not null,
  plan_label_snapshot      text,
  plan_code_snapshot       text,
  provider_name_snapshot   text not null,
  contract_storage_path    text,
  contract_mime_type       text,
  contract_file_size_bytes bigint,
  sent_at                  timestamptz not null default now(),
  sent_by                  uuid references public.profiles (id) on delete set null,
  signed_at                timestamptz,
  signed_by                uuid references public.profiles (id) on delete set null,
  accredited_at            timestamptz,
  accredited_by            uuid references public.profiles (id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index sale_financing_contracts_sale_idx on public.sale_financing_contracts (sale_id);
create trigger sale_financing_contracts_set_updated_at
  before update on public.sale_financing_contracts
  for each row execute function public.set_updated_at();

create table public.financing_contract_events (
  id          uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.sale_financing_contracts (id) on delete cascade,
  from_status text,
  to_status   text not null,
  changed_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  note        text
);
create index financing_contract_events_contract_idx on public.financing_contract_events (contract_id, created_at);

-- ---------------------------------------------------------------------------
-- 6. RLS — solo lectura para el cliente; toda escritura va por RPC.
-- ---------------------------------------------------------------------------
alter table public.sale_financing_contracts enable row level security;
alter table public.financing_contract_events enable row level security;

grant select on public.sale_financing_contracts to authenticated;
grant select on public.financing_contract_events to authenticated;

create policy sale_financing_contracts_select on public.sale_financing_contracts
  for select to authenticated
  using (public.sale_is_own(sale_id) or public.is_admin());

create policy financing_contract_events_select on public.financing_contract_events
  for select to authenticated
  using (exists (
    select 1 from public.sale_financing_contracts c
    where c.id = contract_id and (public.sale_is_own(c.sale_id) or public.is_admin())
  ));

-- ---------------------------------------------------------------------------
-- 7. Storage privado para documentos de contrato de financiación
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('sale-financing-contracts', 'sale-financing-contracts', false)
on conflict (id) do nothing;

-- Ruta: {sellerId}/{saleId}/{contractId}/contract.<ext>
drop policy if exists "financing-contracts read own or admin" on storage.objects;
create policy "financing-contracts read own or admin" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'sale-financing-contracts'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

drop policy if exists "financing-contracts insert own or admin" on storage.objects;
create policy "financing-contracts insert own or admin" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'sale-financing-contracts'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

drop policy if exists "financing-contracts update own or admin" on storage.objects;
create policy "financing-contracts update own or admin" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'sale-financing-contracts'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  )
  with check (
    bucket_id = 'sale-financing-contracts'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

drop policy if exists "financing-contracts delete own or admin" on storage.objects;
create policy "financing-contracts delete own or admin" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'sale-financing-contracts'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

-- ===========================================================================
-- 8. Validación compartida (DRAFT→PENDING y re-chequeo en PENDING→SOLD)
-- ===========================================================================
create or replace function public.validate_cuba_sale_for_review(p_sale_id uuid)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer      public.sale_parties;
  v_recipient  public.sale_cuba_recipients;
  v_delivery   public.sale_deliveries;
  v_errors     text[] := array[]::text[];
  v_unit       record;
  v_unit_count int := 0;
  v_alloc      public.sale_payment_allocations;
  v_method     public.payment_methods;
  v_plan       public.payment_method_plans;
  v_plan_bps   integer;
  v_settle     jsonb;
  v_units_total    bigint := 0;
  v_extras_total   bigint := 0;
  v_delivery_total bigint := 0;
  v_sale_total     bigint := 0;
  v_net_total      bigint := 0;
  v_alloc_count    int := 0;
begin
  -- comprador
  select * into v_buyer from public.sale_parties
    where sale_id = p_sale_id and party_role = 'PRIMARY_BUYER';
  if not found then
    v_errors := array_append(v_errors, 'BUYER_MISSING');
  else
    if coalesce(btrim(v_buyer.first_name), '') = '' then v_errors := array_append(v_errors, 'BUYER_FIRST_NAME_MISSING'); end if;
    if coalesce(btrim(v_buyer.last_name), '') = '' then v_errors := array_append(v_errors, 'BUYER_LAST_NAME_MISSING'); end if;
    if coalesce(btrim(v_buyer.document_number), '') = '' then v_errors := array_append(v_errors, 'BUYER_DOCUMENT_NUMBER_MISSING'); end if;
    if coalesce(btrim(v_buyer.phone), '') = '' then v_errors := array_append(v_errors, 'BUYER_PHONE_MISSING'); end if;
  end if;
  if not exists (select 1 from public.sale_documents where sale_id = p_sale_id and subject_type = 'BUYER' and side = 'FRONT') then
    v_errors := array_append(v_errors, 'BUYER_DOCUMENT_FRONT_MISSING');
  end if;
  if not exists (select 1 from public.sale_documents where sale_id = p_sale_id and subject_type = 'BUYER' and side = 'BACK') then
    v_errors := array_append(v_errors, 'BUYER_DOCUMENT_BACK_MISSING');
  end if;

  -- unidades
  select count(*) into v_unit_count from public.sale_units where sale_id = p_sale_id;
  if v_unit_count = 0 then
    v_errors := array_append(v_errors, 'NO_SALE_UNITS');
  else
    for v_unit in select su.* from public.sale_units su where su.sale_id = p_sale_id loop
      if v_unit.product_id is null then
        v_errors := array_append(v_errors, 'UNIT_PRODUCT_MISSING');
      elsif not exists (select 1 from public.products p where p.id = v_unit.product_id and p.is_active) then
        v_errors := array_append(v_errors, 'UNIT_PRODUCT_INACTIVE');
      elsif v_unit.product_variant_id is not null
        and not exists (select 1 from public.product_variants pv
                        where pv.id = v_unit.product_variant_id and pv.product_id = v_unit.product_id) then
        v_errors := array_append(v_errors, 'UNIT_VARIANT_MISMATCH');
      end if;
      if coalesce(v_unit.agreed_price_cents, 0) <= 0 then
        v_errors := array_append(v_errors, 'UNIT_AGREED_PRICE_INVALID');
      end if;
    end loop;
  end if;

  -- destinatario
  select * into v_recipient from public.sale_cuba_recipients where sale_id = p_sale_id;
  if not found then
    v_errors := array_append(v_errors, 'RECIPIENT_MISSING');
  else
    if coalesce(btrim(v_recipient.full_name), '') = '' then v_errors := array_append(v_errors, 'RECIPIENT_FULL_NAME_MISSING'); end if;
    if coalesce(btrim(v_recipient.identity_number), '') = '' then v_errors := array_append(v_errors, 'RECIPIENT_IDENTITY_NUMBER_MISSING'); end if;
    if coalesce(btrim(v_recipient.delivery_address), '') = '' then v_errors := array_append(v_errors, 'RECIPIENT_DELIVERY_ADDRESS_MISSING'); end if;
    if coalesce(btrim(v_recipient.municipality), '') = '' then v_errors := array_append(v_errors, 'RECIPIENT_MUNICIPALITY_MISSING'); end if;
    if coalesce(btrim(v_recipient.province), '') = '' then v_errors := array_append(v_errors, 'RECIPIENT_PROVINCE_MISSING'); end if;
    if coalesce(btrim(v_recipient.primary_phone), '') = '' then v_errors := array_append(v_errors, 'RECIPIENT_PRIMARY_PHONE_MISSING'); end if;
  end if;
  if not exists (select 1 from public.sale_documents where sale_id = p_sale_id and subject_type = 'CUBA_RECIPIENT' and side = 'FRONT') then
    v_errors := array_append(v_errors, 'RECIPIENT_DOCUMENT_FRONT_MISSING');
  end if;
  if not exists (select 1 from public.sale_documents where sale_id = p_sale_id and subject_type = 'CUBA_RECIPIENT' and side = 'BACK') then
    v_errors := array_append(v_errors, 'RECIPIENT_DOCUMENT_BACK_MISSING');
  end if;

  -- entrega
  select * into v_delivery from public.sale_deliveries where sale_id = p_sale_id;
  if not found then
    v_errors := array_append(v_errors, 'DELIVERY_MISSING');
  elsif coalesce(btrim(v_delivery.method), '') = '' then
    v_errors := array_append(v_errors, 'DELIVERY_METHOD_MISSING');
  end if;

  -- totales
  select coalesce(sum(agreed_price_cents), 0) into v_units_total
    from public.sale_units where sale_id = p_sale_id;
  select coalesce(sum(greatest(1, quantity) * greatest(0, unit_price_cents)), 0) into v_extras_total
    from public.sale_extras where sale_id = p_sale_id;
  v_delivery_total := 0;
  v_sale_total := v_units_total + v_extras_total + v_delivery_total;

  -- liquidación de pagos
  select count(*) into v_alloc_count from public.sale_payment_allocations where sale_id = p_sale_id;
  if v_alloc_count = 0 then
    v_errors := array_append(v_errors, 'NO_PAYMENT_ALLOCATIONS');
  else
    for v_alloc in select * from public.sale_payment_allocations where sale_id = p_sale_id order by position loop
      select * into v_method from public.payment_methods where id = v_alloc.payment_method_id;
      if not found then
        v_errors := array_append(v_errors, 'PAYMENT_METHOD_MISSING');
        continue;
      end if;
      if not v_method.is_active then
        v_errors := array_append(v_errors, 'PAYMENT_METHOD_INACTIVE');
      end if;

      v_plan_bps := null;
      if v_method.fee_strategy = 'INSTALLMENTS' then
        if v_alloc.payment_method_plan_id is null then
          v_errors := array_append(v_errors, 'PAYMENT_PLAN_REQUIRED');
        else
          select * into v_plan from public.payment_method_plans
            where id = v_alloc.payment_method_plan_id and payment_method_id = v_method.id;
          if not found then
            v_errors := array_append(v_errors, 'PAYMENT_PLAN_MISMATCH');
          else
            v_plan_bps := v_plan.fee_bps;
          end if;
        end if;
      end if;

      if v_method.only_florida and coalesce(btrim(v_buyer.state), '') <> 'FL' then
        v_errors := array_append(v_errors, 'PAYMENT_METHOD_FLORIDA_ONLY');
      end if;

      v_settle := public.payment_fee_settlement(
        v_method.fee_strategy, v_alloc.input_mode,
        case when v_alloc.input_mode = 'NET' then v_alloc.net_amount_cents
             else v_alloc.gross_amount_cents end,
        v_method.flat_fee_bps, v_method.flat_fee_cents, v_plan_bps,
        v_method.conditional_threshold_cents, v_method.conditional_below_fee_cents,
        v_method.conditional_above_fee_bps);

      if (v_settle->>'gross')::bigint <> v_alloc.gross_amount_cents
         or (v_settle->>'fee')::bigint <> v_alloc.fee_amount_cents
         or (v_settle->>'net')::bigint <> v_alloc.net_amount_cents then
        v_errors := array_append(v_errors, 'PAYMENT_FEE_MISMATCH');
      end if;

      v_net_total := v_net_total + (v_settle->>'net')::bigint;
    end loop;

    if v_net_total < v_sale_total then
      v_errors := array_append(v_errors, 'PAYMENT_UNDERFUNDED');
    elsif v_net_total > v_sale_total then
      v_errors := array_append(v_errors, 'PAYMENT_OVERFUNDED');
    end if;
  end if;

  return v_errors;
end;
$$;
revoke all on function public.validate_cuba_sale_for_review(uuid) from public, anon, authenticated;

-- ===========================================================================
-- 9. request_sale_review — DRAFT → PENDING (vendedor, dueño de la venta)
-- ===========================================================================
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
  if v_sale.seller_id <> v_uid then
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

  insert into public.sale_status_history (sale_id, from_status, to_status, changed_by)
  values (p_sale_id, 'DRAFT', 'PENDING', v_uid);

  return jsonb_build_object('ok', true, 'saleId', p_sale_id, 'status', 'PENDING');
end;
$$;
revoke all on function public.request_sale_review(uuid) from public, anon;
grant execute on function public.request_sale_review(uuid) to authenticated;

-- ===========================================================================
-- 10. approve_sale_review — PENDING → SOLD (ADMIN)
-- ===========================================================================
create or replace function public.approve_sale_review(p_sale_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_sale  public.sales;
  v_errors text[];
  v_unit  record;
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
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'SALE_NOT_FOUND');
  end if;
  if v_sale.operation_type <> 'CUBA' then
    return jsonb_build_object('ok', false, 'code', 'NOT_CUBA');
  end if;

  if v_sale.status in ('SOLD', 'PAID') then
    return jsonb_build_object('ok', true, 'alreadyApproved', true,
      'saleId', v_sale.id, 'saleNumber', v_sale.sale_number, 'status', v_sale.status);
  end if;
  if v_sale.status <> 'PENDING' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATUS');
  end if;

  v_errors := public.validate_cuba_sale_for_review(p_sale_id);
  if array_length(v_errors, 1) is not null then
    return jsonb_build_object('ok', false, 'code', 'VALIDATION_FAILED', 'errors', to_jsonb(v_errors));
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

  update public.sales set
    status               = 'SOLD',
    sold_at              = now(),
    sold_by              = v_uid,
    sale_number          = v_number,
    units_total_cents    = v_units_total,
    extras_total_cents   = v_extras_total,
    delivery_total_cents = v_delivery_total,
    sale_total_cents     = v_sale_total
  where id = p_sale_id;

  insert into public.sale_status_history (sale_id, from_status, to_status, changed_by)
  values (p_sale_id, 'PENDING', 'SOLD', v_uid);

  return jsonb_build_object('ok', true, 'saleId', p_sale_id, 'saleNumber', v_number,
    'status', 'SOLD', 'saleTotalCents', v_sale_total);
end;
$$;
revoke all on function public.approve_sale_review(uuid) from public, anon;
grant execute on function public.approve_sale_review(uuid) to authenticated;

-- ===========================================================================
-- 11. return_sale_to_draft — PENDING → DRAFT (ADMIN, motivo obligatorio)
-- ===========================================================================
create or replace function public.return_sale_to_draft(p_sale_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_sale   public.sales;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;
  if length(v_reason) < 4 then
    return jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
  end if;

  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'SALE_NOT_FOUND');
  end if;
  if v_sale.status <> 'PENDING' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATUS');
  end if;

  update public.sales set
    status = 'DRAFT',
    review_requested_at = null,
    review_requested_by = null
  where id = p_sale_id;

  insert into public.sale_status_history (sale_id, from_status, to_status, changed_by, reason)
  values (p_sale_id, 'PENDING', 'DRAFT', v_uid, v_reason);

  return jsonb_build_object('ok', true, 'saleId', p_sale_id, 'status', 'DRAFT');
end;
$$;
revoke all on function public.return_sale_to_draft(uuid, text) from public, anon;
grant execute on function public.return_sale_to_draft(uuid, text) to authenticated;

-- ===========================================================================
-- 12. Financiación: recalcular PAID (interno)
-- ===========================================================================
create or replace function public.recompute_sale_paid_status(p_sale_id uuid, p_actor uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale         public.sales;
  v_settled_net  bigint := 0;
  v_all_covered  boolean := true;
  v_alloc        record;
begin
  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then return false; end if;
  if v_sale.status = 'PAID' then return true; end if;
  if v_sale.status <> 'SOLD' then return false; end if;

  for v_alloc in
    select a.id, a.net_amount_cents, a.settlement_status, m.method_type
    from public.sale_payment_allocations a
    join public.payment_methods m on m.id = a.payment_method_id
    where a.sale_id = p_sale_id
  loop
    if v_alloc.method_type = 'FINANCING' then
      if exists (
        select 1 from public.sale_financing_contracts c
        where c.payment_allocation_id = v_alloc.id and c.status = 'ACCREDITED'
      ) then
        v_settled_net := v_settled_net + v_alloc.net_amount_cents;
      else
        v_all_covered := false;
      end if;
    else
      if v_alloc.settlement_status = 'SETTLED' then
        v_settled_net := v_settled_net + v_alloc.net_amount_cents;
      else
        v_all_covered := false;
      end if;
    end if;
  end loop;

  if v_all_covered and v_sale.sale_total_cents > 0 and v_settled_net = v_sale.sale_total_cents then
    update public.sales set status = 'PAID', paid_at = now(), paid_by = p_actor where id = p_sale_id;
    insert into public.sale_status_history (sale_id, from_status, to_status, changed_by, reason)
    values (p_sale_id, 'SOLD', 'PAID', p_actor, 'Liquidación completa (automático)');
    return true;
  end if;
  return false;
end;
$$;
revoke all on function public.recompute_sale_paid_status(uuid, uuid) from public, anon, authenticated;

-- ===========================================================================
-- 13. mark_financing_sent — crea el contrato (ADMIN)
-- ===========================================================================
create or replace function public.mark_financing_sent(
  p_sale_id uuid, p_payment_allocation_id uuid, p_contract_storage_path text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_alloc      public.sale_payment_allocations;
  v_sale       public.sales;
  v_method     public.payment_methods;
  v_plan_code  text;
  v_contract_id uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  select * into v_sale from public.sales where id = p_sale_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'SALE_NOT_FOUND');
  end if;
  if v_sale.status not in ('PENDING', 'SOLD') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_SALE_STATUS');
  end if;

  select * into v_alloc from public.sale_payment_allocations
    where id = p_payment_allocation_id and sale_id = p_sale_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'ALLOCATION_NOT_FOUND');
  end if;

  select * into v_method from public.payment_methods where id = v_alloc.payment_method_id;
  if not found or v_method.method_type <> 'FINANCING' then
    return jsonb_build_object('ok', false, 'code', 'NOT_FINANCING');
  end if;

  if exists (select 1 from public.sale_financing_contracts where payment_allocation_id = p_payment_allocation_id) then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_SENT');
  end if;

  v_plan_code := null;
  if v_alloc.payment_method_plan_id is not null then
    select legacy_code into v_plan_code from public.payment_method_plans
      where id = v_alloc.payment_method_plan_id;
  end if;

  insert into public.sale_financing_contracts (
    sale_id, payment_allocation_id, payment_method_id, status,
    gross_amount_cents, fee_amount_cents, net_amount_cents,
    plan_label_snapshot, plan_code_snapshot, provider_name_snapshot,
    contract_storage_path, sent_at, sent_by)
  values (
    p_sale_id, p_payment_allocation_id, v_alloc.payment_method_id, 'SENT',
    v_alloc.gross_amount_cents, v_alloc.fee_amount_cents, v_alloc.net_amount_cents,
    v_alloc.plan_label_snapshot, v_plan_code, v_alloc.provider_name_snapshot,
    nullif(p_contract_storage_path, ''), now(), v_uid)
  returning id into v_contract_id;

  insert into public.financing_contract_events (contract_id, from_status, to_status, changed_by)
  values (v_contract_id, null, 'SENT', v_uid);

  return jsonb_build_object('ok', true, 'contractId', v_contract_id, 'status', 'SENT');
end;
$$;
revoke all on function public.mark_financing_sent(uuid, uuid, text) from public, anon;
grant execute on function public.mark_financing_sent(uuid, uuid, text) to authenticated;

-- ===========================================================================
-- 14. mark_financing_signed — dueño de la venta O admin
-- ===========================================================================
create or replace function public.mark_financing_signed(p_contract_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_contract public.sale_financing_contracts;
  v_sale     public.sales;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;

  select * into v_contract from public.sale_financing_contracts where id = p_contract_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'CONTRACT_NOT_FOUND');
  end if;

  select * into v_sale from public.sales where id = v_contract.sale_id;
  if v_sale.seller_id <> v_uid and not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_OWNER');
  end if;

  if v_contract.status in ('SIGNED', 'ACCREDITED') then
    return jsonb_build_object('ok', true, 'alreadySigned', true,
      'contractId', p_contract_id, 'status', v_contract.status);
  end if;
  if v_contract.status <> 'SENT' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATUS');
  end if;

  update public.sale_financing_contracts set
    status = 'SIGNED', signed_at = now(), signed_by = v_uid
  where id = p_contract_id;

  insert into public.financing_contract_events (contract_id, from_status, to_status, changed_by, note)
  values (p_contract_id, 'SENT', 'SIGNED', v_uid, nullif(btrim(coalesce(p_note, '')), ''));

  return jsonb_build_object('ok', true, 'contractId', p_contract_id, 'status', 'SIGNED');
end;
$$;
revoke all on function public.mark_financing_signed(uuid, text) from public, anon;
grant execute on function public.mark_financing_signed(uuid, text) to authenticated;

-- ===========================================================================
-- 15. mark_financing_accredited — ADMIN, recalcula PAID
-- ===========================================================================
create or replace function public.mark_financing_accredited(p_contract_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_contract public.sale_financing_contracts;
  v_paid     boolean;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  select * into v_contract from public.sale_financing_contracts where id = p_contract_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'CONTRACT_NOT_FOUND');
  end if;

  if v_contract.status = 'ACCREDITED' then
    v_paid := (select status = 'PAID' from public.sales where id = v_contract.sale_id);
    return jsonb_build_object('ok', true, 'alreadyAccredited', true,
      'contractId', p_contract_id, 'status', 'ACCREDITED', 'salePaid', coalesce(v_paid, false));
  end if;
  if v_contract.status <> 'SIGNED' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATUS');
  end if;

  update public.sale_financing_contracts set
    status = 'ACCREDITED', accredited_at = now(), accredited_by = v_uid
  where id = p_contract_id;

  insert into public.financing_contract_events (contract_id, from_status, to_status, changed_by, note)
  values (p_contract_id, 'SIGNED', 'ACCREDITED', v_uid, nullif(btrim(coalesce(p_note, '')), ''));

  v_paid := public.recompute_sale_paid_status(v_contract.sale_id, v_uid);

  return jsonb_build_object('ok', true, 'contractId', p_contract_id, 'status', 'ACCREDITED', 'salePaid', v_paid);
end;
$$;
revoke all on function public.mark_financing_accredited(uuid, text) from public, anon;
grant execute on function public.mark_financing_accredited(uuid, text) to authenticated;

-- ===========================================================================
-- 16. attach_financing_contract_document — dueño de la venta O admin
-- ===========================================================================
create or replace function public.attach_financing_contract_document(
  p_contract_id uuid, p_storage_path text, p_mime_type text default null, p_file_size_bytes bigint default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_contract public.sale_financing_contracts;
  v_sale     public.sales;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;

  select * into v_contract from public.sale_financing_contracts where id = p_contract_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'CONTRACT_NOT_FOUND');
  end if;

  select * into v_sale from public.sales where id = v_contract.sale_id;
  if v_sale.seller_id <> v_uid and not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_OWNER');
  end if;

  update public.sale_financing_contracts set
    contract_storage_path = p_storage_path,
    contract_mime_type = nullif(p_mime_type, ''),
    contract_file_size_bytes = p_file_size_bytes
  where id = p_contract_id;

  return jsonb_build_object('ok', true, 'contractId', p_contract_id);
end;
$$;
revoke all on function public.attach_financing_contract_document(uuid, text, text, bigint) from public, anon;
grant execute on function public.attach_financing_contract_document(uuid, text, text, bigint) to authenticated;

-- ===========================================================================
-- 17. mark_payment_allocation_settled — pagos directos (CARD/ZELLE/INTERNAL), ADMIN
-- ===========================================================================
create or replace function public.mark_payment_allocation_settled(p_allocation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_alloc  public.sale_payment_allocations;
  v_method public.payment_methods;
  v_paid   boolean;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  select * into v_alloc from public.sale_payment_allocations where id = p_allocation_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'ALLOCATION_NOT_FOUND');
  end if;

  select * into v_method from public.payment_methods where id = v_alloc.payment_method_id;
  if found and v_method.method_type = 'FINANCING' then
    return jsonb_build_object('ok', false, 'code', 'USE_FINANCING_FLOW');
  end if;

  if v_alloc.settlement_status = 'SETTLED' then
    v_paid := (select status = 'PAID' from public.sales where id = v_alloc.sale_id);
    return jsonb_build_object('ok', true, 'alreadySettled', true,
      'allocationId', p_allocation_id, 'salePaid', coalesce(v_paid, false));
  end if;

  update public.sale_payment_allocations set
    settlement_status = 'SETTLED', settled_at = now(), settled_by = v_uid
  where id = p_allocation_id;

  v_paid := public.recompute_sale_paid_status(v_alloc.sale_id, v_uid);

  return jsonb_build_object('ok', true, 'allocationId', p_allocation_id, 'salePaid', v_paid);
end;
$$;
revoke all on function public.mark_payment_allocation_settled(uuid) from public, anon;
grant execute on function public.mark_payment_allocation_settled(uuid) to authenticated;

-- ===========================================================================
-- 18. admin_mark_sale_paid — reintento manual (ADMIN), re-valida siempre
-- ===========================================================================
create or replace function public.admin_mark_sale_paid(p_sale_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_sale public.sales;
  v_paid boolean;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  select * into v_sale from public.sales where id = p_sale_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'SALE_NOT_FOUND');
  end if;
  if v_sale.status = 'PAID' then
    return jsonb_build_object('ok', true, 'alreadyPaid', true, 'saleId', p_sale_id, 'status', 'PAID');
  end if;
  if v_sale.status <> 'SOLD' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATUS');
  end if;

  v_paid := public.recompute_sale_paid_status(p_sale_id, v_uid);
  if not v_paid then
    return jsonb_build_object('ok', false, 'code', 'SETTLEMENT_INCOMPLETE');
  end if;
  return jsonb_build_object('ok', true, 'saleId', p_sale_id, 'status', 'PAID');
end;
$$;
revoke all on function public.admin_mark_sale_paid(uuid) from public, anon;
grant execute on function public.admin_mark_sale_paid(uuid) to authenticated;

-- ===========================================================================
-- 19. admin_pending_sales_list — cola de revisión (ADMIN)
-- ===========================================================================
create or replace function public.admin_pending_sales_list(p_limit int default 50, p_offset int default 0)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_limit  int := greatest(1, least(coalesce(p_limit, 50), 100));
  v_offset int := greatest(0, coalesce(p_offset, 0));
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
        'saleId', s.id,
        'saleNumber', s.sale_number,
        'reviewRequestedAt', s.review_requested_at,
        'sellerName', (select p.full_name from public.profiles p where p.id = s.seller_id),
        'buyerName', (select nullif(btrim(coalesce(sp.first_name, '') || ' ' || coalesce(sp.last_name, '')), '')
                      from public.sale_parties sp
                      where sp.sale_id = s.id and sp.party_role = 'PRIMARY_BUYER'),
        'saleTotalCents', coalesce(s.sale_total_cents, (
          select coalesce(sum(su.agreed_price_cents), 0) from public.sale_units su where su.sale_id = s.id)),
        'unitCount', (select count(*) from public.sale_units su where su.sale_id = s.id))
        order by s.review_requested_at asc nulls last)
      from (
        select * from public.sales
        where status = 'PENDING' and operation_type = 'CUBA'
        order by review_requested_at asc nulls last
        limit v_limit offset v_offset
      ) s
    ), '[]'::jsonb),
    'totalCount', (select count(*) from public.sales where status = 'PENDING' and operation_type = 'CUBA')
  );
end;
$$;
revoke all on function public.admin_pending_sales_list(int, int) from public, anon;
grant execute on function public.admin_pending_sales_list(int, int) to authenticated;

-- ===========================================================================
-- 20. update_confirmed_cuba_sale — ahora exige SOLD (antes CONFIRMED)
-- ===========================================================================
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
  if v_sale.seller_id <> v_uid then
    return jsonb_build_object('ok', false, 'code', 'NOT_OWNER');
  end if;
  if v_sale.operation_type <> 'CUBA' then
    return jsonb_build_object('ok', false, 'code', 'NOT_CUBA');
  end if;
  if v_sale.status <> 'SOLD' then
    return jsonb_build_object('ok', false, 'code', 'NOT_SOLD');
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

  if array_length(v_errors, 1) is not null then
    return jsonb_build_object('ok', false, 'code', 'VALIDATION_FAILED', 'errors', to_jsonb(v_errors));
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

  select count(*) into v_change_count
    from public.sale_change_history where edit_group = v_group;

  return jsonb_build_object(
    'ok', true,
    'saleId', p_sale_id,
    'saleNumber', v_sale.sale_number,
    'status', 'SOLD',
    'unitsTotalCents', v_units_total,
    'extrasTotalCents', v_extras_total,
    'deliveryTotalCents', v_delivery_total,
    'saleTotalCents', v_sale_total,
    'changeCount', v_change_count,
    'editGroup', v_group);
end;
$$;

revoke all on function public.update_confirmed_cuba_sale(uuid, jsonb, text) from public, anon;
grant execute on function public.update_confirmed_cuba_sale(uuid, jsonb, text) to authenticated;

-- ===========================================================================
-- 21. confirm_cuba_sale — reemplazada por el flujo de revisión; se elimina
--     para que nada pueda intentar poner status='CONFIRMED' (valor que el
--     nuevo check constraint ya no acepta).
-- ===========================================================================
drop function if exists public.confirm_cuba_sale(uuid);

-- ===========================================================================
-- 22. seller_dashboard_data — cuenta SOLD + PAID (antes solo CONFIRMED)
-- ===========================================================================
create or replace function public.seller_dashboard_data(
  p_start      date,
  p_end        date,
  p_prev_start date,
  p_prev_end   date
)
returns jsonb
language sql
security invoker
set search_path = public
stable
as $$
  with confirmed as (
    select s.id, s.sale_date, s.operation_type, s.sale_total_cents
    from public.sales s
    where s.seller_id = auth.uid()
      and s.status in ('SOLD', 'PAID')
      and s.operation_type in ('CUBA', 'USA', 'LOCAL')
  ),
  cur as (
    select * from confirmed where sale_date between p_start and p_end
  ),
  prev as (
    select * from confirmed where sale_date between p_prev_start and p_prev_end
  ),
  cur_units as (
    select su.id, c.sale_date, c.operation_type,
           coalesce(nullif(btrim(su.product_name_snapshot), ''), 'Sin modelo') as model
    from public.sale_units su
    join cur c on c.id = su.sale_id
  ),
  prev_units as (
    select su.id from public.sale_units su join prev p on p.id = su.sale_id
  )
  select jsonb_build_object(
    'revenue', jsonb_build_object(
      'currentCents',  coalesce((select sum(sale_total_cents) from cur), 0),
      'previousCents', coalesce((select sum(sale_total_cents) from prev), 0)
    ),
    'units', jsonb_build_object(
      'current',  (select count(*) from cur_units),
      'previous', (select count(*) from prev_units)
    ),
    'unitsByType', jsonb_build_object(
      'cuba',  (select count(*) from cur_units where operation_type = 'CUBA'),
      'usa',   (select count(*) from cur_units where operation_type = 'USA'),
      'local', (select count(*) from cur_units where operation_type = 'LOCAL')
    ),
    'telemetry', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'date',  to_char(d.sale_date, 'YYYY-MM-DD'),
          'cuba',  d.cuba, 'usa', d.usa, 'local', d.local)
        order by d.sale_date)
      from (
        select cu.sale_date,
          count(*) filter (where cu.operation_type = 'CUBA')  as cuba,
          count(*) filter (where cu.operation_type = 'USA')   as usa,
          count(*) filter (where cu.operation_type = 'LOCAL') as local
        from cur_units cu
        group by cu.sale_date
      ) d
    ), '[]'::jsonb),
    'topModels', coalesce((
      select jsonb_agg(
        jsonb_build_object('modelName', t.model, 'units', t.units)
        order by t.units desc, t.model)
      from (
        select model, count(*) as units
        from cur_units
        group by model
        order by units desc, model
        limit 6
      ) t
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.seller_dashboard_data(date, date, date, date) from public, anon;
grant execute on function public.seller_dashboard_data(date, date, date, date) to authenticated;

-- ===========================================================================
-- 23. get_cuba_sale_draft — + statusHistory + paymentAllocations enriquecidas
--     + financingContracts + financingContractEvents
-- ===========================================================================
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
                          from public.sale_documents sd where sd.sale_id = s.id), '[]'::jsonb),
    'changeHistory', coalesce((select jsonb_agg(jsonb_build_object(
                             'id', h.id,
                             'editGroup', h.edit_group,
                             'changedAt', h.changed_at,
                             'changedByName', (select pr.full_name from public.profiles pr
                                               where pr.id = h.changed_by),
                             'reason', h.reason,
                             'fieldPath', h.field_path,
                             'changeType', h.change_type,
                             'oldValue', h.old_value,
                             'newValue', h.new_value)
                             order by h.changed_at desc, h.field_path)
                          from public.sale_change_history h where h.sale_id = s.id), '[]'::jsonb),
    'statusHistory', coalesce((select jsonb_agg(jsonb_build_object(
                             'id', sh.id,
                             'fromStatus', sh.from_status,
                             'toStatus', sh.to_status,
                             'changedAt', sh.created_at,
                             'changedByName', (select pr.full_name from public.profiles pr
                                               where pr.id = sh.changed_by),
                             'reason', sh.reason)
                             order by sh.created_at asc)
                          from public.sale_status_history sh where sh.sale_id = s.id), '[]'::jsonb),
    'paymentAllocations', coalesce((select jsonb_agg(jsonb_build_object(
                             'id', a.id,
                             'paymentMethodId', a.payment_method_id,
                             'paymentMethodPlanId', a.payment_method_plan_id,
                             'position', a.position,
                             'inputMode', a.input_mode,
                             'grossAmountCents', a.gross_amount_cents,
                             'feeAmountCents', a.fee_amount_cents,
                             'netAmountCents', a.net_amount_cents,
                             'feeBpsSnapshot', a.fee_bps_snapshot,
                             'fixedFeeCentsSnapshot', a.fixed_fee_cents_snapshot,
                             'providerNameSnapshot', a.provider_name_snapshot,
                             'planLabelSnapshot', a.plan_label_snapshot,
                             'feeStrategySnapshot', a.fee_strategy_snapshot,
                             'methodType', (select m.method_type from public.payment_methods m
                                            where m.id = a.payment_method_id),
                             'methodOnlyFlorida', (select m.only_florida from public.payment_methods m
                                                   where m.id = a.payment_method_id),
                             'methodIsActive', (select m.is_active from public.payment_methods m
                                                where m.id = a.payment_method_id),
                             'settlementStatus', a.settlement_status,
                             'settledAt', a.settled_at,
                             'financingContractId', (select c.id from public.sale_financing_contracts c
                                                     where c.payment_allocation_id = a.id),
                             'reference', a.reference,
                             'notes', a.notes)
                             order by a.position)
                          from public.sale_payment_allocations a where a.sale_id = s.id), '[]'::jsonb),
    'financingContracts', coalesce((select jsonb_agg(jsonb_build_object(
                             'id', c.id,
                             'paymentAllocationId', c.payment_allocation_id,
                             'paymentMethodId', c.payment_method_id,
                             'status', c.status,
                             'grossAmountCents', c.gross_amount_cents,
                             'feeAmountCents', c.fee_amount_cents,
                             'netAmountCents', c.net_amount_cents,
                             'planLabelSnapshot', c.plan_label_snapshot,
                             'planCodeSnapshot', c.plan_code_snapshot,
                             'providerNameSnapshot', c.provider_name_snapshot,
                             'contractStoragePath', c.contract_storage_path,
                             'sentAt', c.sent_at,
                             'sentByName', (select pr.full_name from public.profiles pr where pr.id = c.sent_by),
                             'signedAt', c.signed_at,
                             'signedByName', (select pr.full_name from public.profiles pr where pr.id = c.signed_by),
                             'accreditedAt', c.accredited_at,
                             'accreditedByName', (select pr.full_name from public.profiles pr where pr.id = c.accredited_by))
                             order by c.sent_at)
                          from public.sale_financing_contracts c where c.sale_id = s.id), '[]'::jsonb),
    'financingContractEvents', coalesce((select jsonb_agg(jsonb_build_object(
                             'id', e.id,
                             'contractId', e.contract_id,
                             'fromStatus', e.from_status,
                             'toStatus', e.to_status,
                             'changedAt', e.created_at,
                             'changedByName', (select pr.full_name from public.profiles pr where pr.id = e.changed_by),
                             'note', e.note)
                             order by e.created_at)
                          from public.financing_contract_events e
                          where e.contract_id in (select id from public.sale_financing_contracts where sale_id = s.id)
                          ), '[]'::jsonb)
  )
  from public.sales s
  where s.id = p_sale_id;   -- RLS: solo ventas propias / admin
$$;

-- ===========================================================================
-- 24. seller_sales_list — estados nuevos + resumen de financiación
-- ===========================================================================
create or replace function public.seller_sales_list(
  p_search          text default null,
  p_start_date      date default null,
  p_end_date        date default null,
  p_status          text default 'ALL',
  p_operation_type  text default 'ALL',
  p_financing_status text default 'ALL',
  p_limit           int  default 20,
  p_offset          int  default 0
)
returns jsonb
language sql
security invoker
set search_path = public
stable
as $$
  with args as (
    select
      nullif(btrim(coalesce(p_search, '')), '')            as search,
      coalesce(nullif(upper(btrim(p_status)), ''), 'ALL')  as status,
      coalesce(nullif(upper(btrim(p_operation_type)), ''), 'ALL') as operation_type,
      coalesce(nullif(upper(btrim(p_financing_status)), ''), 'ALL') as financing_status,
      greatest(1, least(coalesce(p_limit, 20), 100))       as page_size,
      greatest(0, coalesce(p_offset, 0))                   as row_offset
  ),
  base as (
    select
      s.id, s.sale_number, s.status, s.operation_type, s.sale_date, s.created_at,
      s.sold_at, s.paid_at, s.review_requested_at, s.sale_total_cents,
      coalesce(s.sale_date, s.created_at::date) as effective_date
    from public.sales s, args a
    where s.seller_id = auth.uid()
      and (a.status = 'ALL' or s.status = a.status)
      and (a.operation_type = 'ALL' or s.operation_type = a.operation_type)
      and (p_start_date is null or coalesce(s.sale_date, s.created_at::date) >= p_start_date)
      and (p_end_date   is null or coalesce(s.sale_date, s.created_at::date) <= p_end_date)
  ),
  fin as (
    select
      b.id as sale_id,
      count(*) filter (where m.method_type = 'FINANCING')                as providers,
      count(*) filter (where m.method_type = 'FINANCING' and c.id is null) as pending_contract,
      count(*) filter (where c.status = 'SENT')                          as sent,
      count(*) filter (where c.status = 'SIGNED')                        as signed,
      count(*) filter (where c.status = 'ACCREDITED')                    as accredited
    from base b
    left join public.sale_payment_allocations a on a.sale_id = b.id
    left join public.payment_methods m on m.id = a.payment_method_id
    left join public.sale_financing_contracts c on c.payment_allocation_id = a.id
    group by b.id
  ),
  matched as (
    select b.*, coalesce(f.providers, 0) as fin_providers,
           coalesce(f.pending_contract, 0) as fin_pending, coalesce(f.sent, 0) as fin_sent,
           coalesce(f.signed, 0) as fin_signed, coalesce(f.accredited, 0) as fin_accredited
    from base b
    left join fin f on f.sale_id = b.id, args a
    where (
      a.search is null
      or b.sale_number ilike '%' || a.search || '%'
      or exists (
           select 1 from public.sale_parties sp
           where sp.sale_id = b.id
             and sp.party_role = 'PRIMARY_BUYER'
             and (
               coalesce(sp.first_name, '') ilike '%' || a.search || '%'
               or coalesce(sp.last_name, '') ilike '%' || a.search || '%'
               or btrim(coalesce(sp.first_name, '') || ' ' || coalesce(sp.last_name, ''))
                    ilike '%' || a.search || '%'
             )
         )
      or exists (
           select 1 from public.sale_units su
           where su.sale_id = b.id
             and (
               coalesce(su.product_name_snapshot, '') ilike '%' || a.search || '%'
               or coalesce(su.tracking_code, '') ilike '%' || a.search || '%'
             )
         )
      or exists (
           select 1 from public.sale_payment_allocations al
           where al.sale_id = b.id
             and coalesce(al.provider_name_snapshot, '') ilike '%' || a.search || '%'
         )
    )
    and (
      a.financing_status = 'ALL'
      or (a.financing_status = 'NONE' and coalesce(f.providers, 0) = 0)
      or (a.financing_status = 'PENDING_CONTRACT' and coalesce(f.pending_contract, 0) > 0)
      or (a.financing_status = 'SENT' and coalesce(f.sent, 0) > 0)
      or (a.financing_status = 'SIGNED' and coalesce(f.signed, 0) > 0)
      or (a.financing_status = 'ACCREDITED' and coalesce(f.accredited, 0) > 0)
    )
  ),
  page_rows as (
    select m.*
    from matched m, args a
    order by m.effective_date desc, m.created_at desc
    limit  (select page_size from args)
    offset (select row_offset from args)
  ),
  items as (
    select
      m.effective_date,
      m.created_at,
      jsonb_build_object(
        'saleId',          m.id,
        'saleNumber',      m.sale_number,
        'status',          m.status,
        'operationType',   m.operation_type,
        'saleDate',        to_char(m.effective_date, 'YYYY-MM-DD'),
        'hasExplicitDate', (m.sale_date is not null),
        'soldAt',          m.sold_at,
        'paidAt',          m.paid_at,
        'reviewRequestedAt', m.review_requested_at,
        'buyerName', (
          select nullif(btrim(coalesce(sp.first_name, '') || ' ' || coalesce(sp.last_name, '')), '')
          from public.sale_parties sp
          where sp.sale_id = m.id and sp.party_role = 'PRIMARY_BUYER'
        ),
        'unitCount', (select count(*) from public.sale_units su where su.sale_id = m.id),
        'units', coalesce((
          select jsonb_agg(
                   jsonb_build_object(
                     'productName',  su.product_name_snapshot,
                     'variant',      su.variant_snapshot,
                     'trackingCode', su.tracking_code)
                   order by su.position)
          from (
            select su2.*
            from public.sale_units su2
            where su2.sale_id = m.id
            order by su2.position
            limit 6
          ) su
        ), '[]'::jsonb),
        'saleTotalCents', coalesce(
          m.sale_total_cents,
          (select coalesce(sum(su.agreed_price_cents), 0)
             from public.sale_units su where su.sale_id = m.id)
          + (select coalesce(sum(greatest(1, se.quantity) * greatest(0, se.unit_price_cents)), 0)
             from public.sale_extras se where se.sale_id = m.id)
        ),
        'financing', jsonb_build_object(
          'providers', m.fin_providers,
          'pendingContract', m.fin_pending,
          'sent', m.fin_sent,
          'signed', m.fin_signed,
          'accredited', m.fin_accredited
        )
      ) as item
    from page_rows m
  )
  select jsonb_build_object(
    'items', coalesce(
      (select jsonb_agg(item order by effective_date desc, created_at desc) from items),
      '[]'::jsonb),
    'page', (
      (select row_offset from args) / (select page_size from args)
    )::int + 1,
    'pageSize', (select page_size from args),
    'totalCount', (select count(*) from matched),
    'summary', jsonb_build_object(
      'operations',   (select count(*) from matched),
      'draftCount',   (select count(*) from matched where status = 'DRAFT'),
      'pendingCount', (select count(*) from matched where status = 'PENDING'),
      'soldCount',    (select count(*) from matched where status = 'SOLD'),
      'paidCount',    (select count(*) from matched where status = 'PAID'),
      'volumeCents',
        coalesce((select sum(sale_total_cents) from matched where status in ('SOLD', 'PAID')), 0),
      'unitsSold', (
        select count(*)
        from public.sale_units su
        join matched mm on mm.id = su.sale_id and mm.status in ('SOLD', 'PAID')
      )
    )
  );
$$;

revoke all on function public.seller_sales_list(text, date, date, text, text, text, int, int)
  from public, anon;
grant execute on function public.seller_sales_list(text, date, date, text, text, text, int, int)
  to authenticated;

drop function if exists public.seller_sales_list(text, date, date, text, text, int, int);
