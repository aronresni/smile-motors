-- ===========================================================================
-- PRECIO + LIQUIDACIÓN DE PAGOS / FINANCIACIÓN de ventas CUBA.
--
-- - Catálogo relacional de métodos de pago + planes (financieras a plazos).
-- - Motor de fees determinista en SQL (`payment_fee_settlement`) que refleja
--   EXACTAMENTE `src/lib/payments/fee-engine.ts`. Todo en centavos enteros;
--   porcentajes en basis points.
-- - `sale_payment_allocations`: N fuentes de pago por venta, con snapshots
--   históricos (una venta antigua NO cambia si un admin edita un fee).
-- - `save_cuba_sale_draft` sincroniza allocations (recalcula fee/net server-side).
-- - `confirm_cuba_sale` EXIGE cobertura exacta: Σ net = sale_total_cents.
-- - `get_cuba_sale_draft` devuelve `paymentAllocations`.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Catálogo
-- ---------------------------------------------------------------------------
create table public.payment_methods (
  id                                uuid primary key default gen_random_uuid(),
  legacy_id                         text not null unique,
  method_type                       text not null
    check (method_type in ('CARD', 'ZELLE', 'FINANCING', 'INTERNAL')),
  name                              text not null,
  subtext                           text,
  icon_key                          text,
  is_active                         boolean not null default true,
  website_url                       text,
  website_enabled                   boolean not null default false,
  only_florida                      boolean not null default false,
  requires_signed_contract          boolean not null default false,
  has_queue                         boolean not null default false,
  queue_limit_mode                  text,
  queue_daily_limit                 bigint,
  branch_scope                      text,
  fee_strategy                      text not null
    check (fee_strategy in ('NONE', 'FLAT_RATE', 'FIXED_AMOUNT',
                            'FIXED_PLUS_PERCENT', 'INSTALLMENTS', 'CONDITIONAL')),
  flat_fee_bps                      integer,
  flat_fee_cents                    bigint,
  conditional_threshold_cents       bigint,
  conditional_below_fee_cents       bigint,
  conditional_above_fee_bps         integer,
  interest_paid_by_customer_fee_bps integer,
  zelle_account                     text,
  position                          integer not null default 0,
  created_at                        timestamptz not null default now(),
  updated_at                        timestamptz not null default now()
);
create index payment_methods_active_idx on public.payment_methods (is_active, position);
create trigger payment_methods_set_updated_at
  before update on public.payment_methods
  for each row execute function public.set_updated_at();

create table public.payment_method_plans (
  id                uuid primary key default gen_random_uuid(),
  payment_method_id uuid not null references public.payment_methods (id) on delete cascade,
  legacy_code       text,
  label             text not null,
  fee_bps           integer not null,
  term_months       integer,
  position          integer not null default 0,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (payment_method_id, position)
);
create index payment_method_plans_method_idx on public.payment_method_plans (payment_method_id, position);
create trigger payment_method_plans_set_updated_at
  before update on public.payment_method_plans
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Allocations por venta
-- ---------------------------------------------------------------------------
create table public.sale_payment_allocations (
  id                       uuid primary key default gen_random_uuid(),
  sale_id                  uuid not null references public.sales (id) on delete cascade,
  payment_method_id        uuid not null references public.payment_methods (id) on delete restrict,
  payment_method_plan_id   uuid references public.payment_method_plans (id) on delete restrict,
  position                 integer not null default 0,
  input_mode               text not null check (input_mode in ('GROSS', 'NET')),
  gross_amount_cents       bigint not null default 0,
  fee_amount_cents         bigint not null default 0,
  net_amount_cents         bigint not null default 0,
  fee_bps_snapshot         integer,
  fixed_fee_cents_snapshot bigint,
  provider_name_snapshot   text not null,
  plan_label_snapshot      text,
  fee_strategy_snapshot    text not null,
  reference                text,
  notes                    text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index sale_payment_allocations_sale_idx on public.sale_payment_allocations (sale_id, position);
create trigger sale_payment_allocations_set_updated_at
  before update on public.sale_payment_allocations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------
alter table public.payment_methods            enable row level security;
alter table public.payment_method_plans       enable row level security;
alter table public.sale_payment_allocations   enable row level security;

grant select on public.payment_methods to authenticated;
grant select on public.payment_method_plans to authenticated;
grant select, insert, update, delete on public.sale_payment_allocations to authenticated;

-- Catálogo: los vendedores LEEN métodos activos; sin escritura (admin, luego).
create policy payment_methods_select on public.payment_methods
  for select to authenticated
  using (is_active or public.is_admin());

create policy payment_method_plans_select on public.payment_method_plans
  for select to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.payment_methods m
               where m.id = payment_method_id and m.is_active)
  );

-- Allocations: leer las de ventas propias; CRUD solo en ventas propias en DRAFT.
create policy sale_payment_allocations_select on public.sale_payment_allocations
  for select to authenticated
  using (public.sale_is_own(sale_id) or public.is_admin());
create policy sale_payment_allocations_write on public.sale_payment_allocations
  for all to authenticated
  using (public.sale_is_own_draft(sale_id))
  with check (public.sale_is_own_draft(sale_id));

-- ---------------------------------------------------------------------------
-- 4. Motor de fees (SQL) — refleja src/lib/payments/fee-engine.ts
-- ---------------------------------------------------------------------------
create or replace function public.payment_bps_fee(p_amount bigint, p_bps integer)
returns bigint
language sql
immutable
as $$
  select round(greatest(0, coalesce(p_amount, 0))::numeric
               * greatest(0, coalesce(p_bps, 0)) / 10000)::bigint;
$$;

create or replace function public.compute_payment_fee(
  p_strategy text,
  p_gross bigint,
  p_flat_bps integer default null,
  p_flat_cents bigint default null,
  p_plan_bps integer default null,
  p_cond_threshold bigint default null,
  p_cond_below bigint default null,
  p_cond_above_bps integer default null)
returns bigint
language plpgsql
immutable
as $$
declare
  g bigint := greatest(0, coalesce(p_gross, 0));
  f bigint := 0;
begin
  if p_strategy = 'NONE' then
    f := 0;
  elsif p_strategy = 'FLAT_RATE' then
    f := public.payment_bps_fee(g, coalesce(p_flat_bps, 0));
  elsif p_strategy = 'FIXED_AMOUNT' then
    f := coalesce(p_flat_cents, 0);
  elsif p_strategy = 'FIXED_PLUS_PERCENT' then
    f := coalesce(p_flat_cents, 0) + public.payment_bps_fee(g, coalesce(p_flat_bps, 0));
  elsif p_strategy = 'INSTALLMENTS' then
    f := public.payment_bps_fee(g, coalesce(p_plan_bps, 0));
  elsif p_strategy = 'CONDITIONAL' then
    if g < coalesce(p_cond_threshold, 0) then
      f := coalesce(p_cond_below, 0);
    else
      f := public.payment_bps_fee(g, coalesce(p_cond_above_bps, 0));
    end if;
  else
    f := 0;
  end if;
  return greatest(0, least(f, g));
end;
$$;

create or replace function public._pay_net_from_gross(
  p_strategy text, p_gross bigint,
  p_flat_bps integer, p_flat_cents bigint, p_plan_bps integer,
  p_ct bigint, p_cb bigint, p_ca_bps integer)
returns bigint
language sql
immutable
as $$
  select greatest(0, coalesce(p_gross, 0)) - public.compute_payment_fee(
    p_strategy, p_gross, p_flat_bps, p_flat_cents, p_plan_bps, p_ct, p_cb, p_ca_bps);
$$;

-- Liquidación (gross/fee/net) según modo de entrada. Inverso = búsqueda binaria
-- entera, igual que `solveGross` en el motor de TS.
create or replace function public.payment_fee_settlement(
  p_strategy text,
  p_input_mode text,
  p_amount bigint,
  p_flat_bps integer default null,
  p_flat_cents bigint default null,
  p_plan_bps integer default null,
  p_cond_threshold bigint default null,
  p_cond_below bigint default null,
  p_cond_above_bps integer default null)
returns jsonb
language plpgsql
immutable
as $$
declare
  a   bigint := greatest(0, coalesce(p_amount, 0));
  g   bigint;
  fee bigint;
  lo  bigint;
  hi  bigint;
  mid bigint;
  guard int := 0;
  max_money constant bigint := 100000000000; -- 1e11 centavos
begin
  if coalesce(p_input_mode, 'GROSS') = 'GROSS' then
    g := a;
    fee := public.compute_payment_fee(p_strategy, g, p_flat_bps, p_flat_cents,
             p_plan_bps, p_cond_threshold, p_cond_below, p_cond_above_bps);
    return jsonb_build_object('gross', g, 'fee', fee, 'net', g - fee);
  end if;

  -- NET mode
  if a = 0 then
    return jsonb_build_object('gross', 0, 'fee', 0, 'net', 0);
  end if;

  if p_strategy = 'NONE' then
    return jsonb_build_object('gross', a, 'fee', 0, 'net', a);
  end if;

  if p_strategy = 'FIXED_AMOUNT' then
    g := a + coalesce(p_flat_cents, 0);
    fee := public.compute_payment_fee('FIXED_AMOUNT', g, null, p_flat_cents,
             null, null, null, null);
    return jsonb_build_object('gross', g, 'fee', fee, 'net', g - fee);
  end if;

  if p_strategy = 'CONDITIONAL' then
    g := a + coalesce(p_cond_below, 0);
    if g < coalesce(p_cond_threshold, 0) then
      fee := public.compute_payment_fee('CONDITIONAL', g, null, null, null,
               p_cond_threshold, p_cond_below, p_cond_above_bps);
      return jsonb_build_object('gross', g, 'fee', fee, 'net', g - fee);
    end if;
    lo := a; hi := a;
    while public._pay_net_from_gross('CONDITIONAL', hi, null, null, null,
            p_cond_threshold, p_cond_below, p_cond_above_bps) < a
          and hi < max_money and guard < 80 loop
      hi := hi * 2 + 1; guard := guard + 1;
    end loop;
    while lo < hi loop
      mid := (lo + hi) / 2;
      if public._pay_net_from_gross('CONDITIONAL', mid, null, null, null,
           p_cond_threshold, p_cond_below, p_cond_above_bps) >= a then
        hi := mid;
      else
        lo := mid + 1;
      end if;
    end loop;
    g := greatest(lo, coalesce(p_cond_threshold, 0));
    fee := public.compute_payment_fee('CONDITIONAL', g, null, null, null,
             p_cond_threshold, p_cond_below, p_cond_above_bps);
    return jsonb_build_object('gross', g, 'fee', fee, 'net', g - fee);
  end if;

  -- FLAT_RATE / FIXED_PLUS_PERCENT / INSTALLMENTS
  lo := a; hi := a;
  while public._pay_net_from_gross(p_strategy, hi, p_flat_bps, p_flat_cents,
          p_plan_bps, p_cond_threshold, p_cond_below, p_cond_above_bps) < a
        and hi < max_money and guard < 80 loop
    hi := hi * 2 + 1; guard := guard + 1;
  end loop;
  while lo < hi loop
    mid := (lo + hi) / 2;
    if public._pay_net_from_gross(p_strategy, mid, p_flat_bps, p_flat_cents,
         p_plan_bps, p_cond_threshold, p_cond_below, p_cond_above_bps) >= a then
      hi := mid;
    else
      lo := mid + 1;
    end if;
  end loop;
  g := lo;
  fee := public.compute_payment_fee(p_strategy, g, p_flat_bps, p_flat_cents,
           p_plan_bps, p_cond_threshold, p_cond_below, p_cond_above_bps);
  return jsonb_build_object('gross', g, 'fee', fee, 'net', g - fee);
end;
$$;

revoke all on function public.payment_bps_fee(bigint, integer) from public, anon;
revoke all on function public.compute_payment_fee(text, bigint, integer, bigint, integer, bigint, bigint, integer) from public, anon;
revoke all on function public._pay_net_from_gross(text, bigint, integer, bigint, integer, bigint, bigint, integer) from public, anon;
revoke all on function public.payment_fee_settlement(text, text, bigint, integer, bigint, integer, bigint, bigint, integer) from public, anon;
grant execute on function public.compute_payment_fee(text, bigint, integer, bigint, integer, bigint, bigint, integer) to authenticated;
grant execute on function public.payment_fee_settlement(text, text, bigint, integer, bigint, integer, bigint, bigint, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Helper interno: sincroniza las allocations de un borrador desde el payload
--    (recalcula fee/net autoritativos + snapshots). Reutilizado por save y por
--    la revalidación de confirm.
-- ---------------------------------------------------------------------------
create or replace function public.sync_sale_payment_allocations(
  p_sale_id uuid, p_allocations jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_arr    jsonb := case when jsonb_typeof(p_allocations) = 'array'
                         then p_allocations else '[]'::jsonb end;
  v_a      jsonb;
  v_method public.payment_methods;
  v_plan   public.payment_method_plans;
  v_plan_bps integer;
  v_mode   text;
  v_amount bigint;
  v_settle jsonb;
  v_pos    int := 0;
begin
  delete from public.sale_payment_allocations where sale_id = p_sale_id;

  for v_a in select * from jsonb_array_elements(v_arr) loop
    select * into v_method from public.payment_methods
      where id = nullif(v_a->>'paymentMethodId', '')::uuid;
    if not found then
      raise exception 'método de pago inválido';
    end if;

    v_plan := null;
    v_plan_bps := null;
    if nullif(v_a->>'planId', '') is not null then
      select * into v_plan from public.payment_method_plans
        where id = (v_a->>'planId')::uuid and payment_method_id = v_method.id;
      if not found then
        raise exception 'el plan no pertenece a la financiera';
      end if;
      v_plan_bps := v_plan.fee_bps;
    end if;

    v_mode := case when upper(coalesce(v_a->>'inputMode', 'GROSS')) = 'NET'
                   then 'NET' else 'GROSS' end;
    v_amount := greatest(0, coalesce((v_a->>'amountCents')::bigint, 0));

    v_settle := public.payment_fee_settlement(
      v_method.fee_strategy, v_mode, v_amount,
      v_method.flat_fee_bps, v_method.flat_fee_cents, v_plan_bps,
      v_method.conditional_threshold_cents, v_method.conditional_below_fee_cents,
      v_method.conditional_above_fee_bps);

    insert into public.sale_payment_allocations (
      sale_id, payment_method_id, payment_method_plan_id, position, input_mode,
      gross_amount_cents, fee_amount_cents, net_amount_cents,
      fee_bps_snapshot, fixed_fee_cents_snapshot,
      provider_name_snapshot, plan_label_snapshot, fee_strategy_snapshot,
      reference, notes)
    values (
      p_sale_id, v_method.id, v_plan.id, v_pos, v_mode,
      (v_settle->>'gross')::bigint, (v_settle->>'fee')::bigint, (v_settle->>'net')::bigint,
      coalesce(v_plan_bps, v_method.flat_fee_bps), v_method.flat_fee_cents,
      v_method.name, v_plan.label, v_method.fee_strategy,
      nullif(v_a->>'reference', ''), nullif(v_a->>'notes', ''));

    v_pos := v_pos + 1;
  end loop;
end;
$$;
revoke all on function public.sync_sale_payment_allocations(uuid, jsonb) from public, anon;
grant execute on function public.sync_sale_payment_allocations(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. save_cuba_sale_draft — + sincronización de allocations
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

  -- unidades
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
-- 7. get_cuba_sale_draft — + paymentAllocations
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
                             'reference', a.reference,
                             'notes', a.notes)
                             order by a.position)
                          from public.sale_payment_allocations a where a.sale_id = s.id), '[]'::jsonb)
  )
  from public.sales s
  where s.id = p_sale_id;   -- RLS: solo ventas propias / admin
$$;

-- ---------------------------------------------------------------------------
-- 8. confirm_cuba_sale — EXIGE liquidación exacta (Σ net = sale_total_cents)
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
  -- Comprador
  ---------------------------------------------------------------------------
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

  ---------------------------------------------------------------------------
  -- Unidades
  ---------------------------------------------------------------------------
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

  ---------------------------------------------------------------------------
  -- Destinatario en Cuba
  ---------------------------------------------------------------------------
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

  ---------------------------------------------------------------------------
  -- Entrega
  ---------------------------------------------------------------------------
  select * into v_delivery from public.sale_deliveries where sale_id = p_sale_id;
  if not found then
    v_errors := array_append(v_errors, 'DELIVERY_MISSING');
  elsif coalesce(btrim(v_delivery.method), '') = '' then
    v_errors := array_append(v_errors, 'DELIVERY_METHOD_MISSING');
  end if;

  ---------------------------------------------------------------------------
  -- Totales autoritativos de la venta
  ---------------------------------------------------------------------------
  select coalesce(sum(agreed_price_cents), 0) into v_units_total
    from public.sale_units where sale_id = p_sale_id;
  select coalesce(sum(greatest(1, quantity) * greatest(0, unit_price_cents)), 0) into v_extras_total
    from public.sale_extras where sale_id = p_sale_id;
  v_delivery_total := 0; -- sin motor de precio de envío
  v_sale_total := v_units_total + v_extras_total + v_delivery_total;

  ---------------------------------------------------------------------------
  -- Liquidación / cobertura de pagos (autoritativa)
  ---------------------------------------------------------------------------
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

      -- Recalcular contra la config ACTUAL del método y comparar con lo persistido.
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

  if array_length(v_errors, 1) is not null then
    return jsonb_build_object('ok', false, 'code', 'VALIDATION_FAILED', 'errors', to_jsonb(v_errors));
  end if;

  ---------------------------------------------------------------------------
  -- Número de venta + tracking + transición
  ---------------------------------------------------------------------------
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
    status               = 'CONFIRMED',
    confirmed_at         = now(),
    confirmed_by         = v_uid,
    sale_number          = v_number,
    units_total_cents    = v_units_total,
    extras_total_cents   = v_extras_total,
    delivery_total_cents = v_delivery_total,
    sale_total_cents     = v_sale_total
  where id = p_sale_id;

  return jsonb_build_object(
    'ok', true,
    'saleId', p_sale_id,
    'saleNumber', v_number,
    'status', 'CONFIRMED',
    'unitsTotalCents', v_units_total,
    'extrasTotalCents', v_extras_total,
    'deliveryTotalCents', v_delivery_total,
    'saleTotalCents', v_sale_total,
    'netCoveredCents', v_net_total,
    'unitCount', v_unit_count);
end;
$$;

revoke all on function public.confirm_cuba_sale(uuid) from public, anon;
grant execute on function public.confirm_cuba_sale(uuid) to authenticated;
