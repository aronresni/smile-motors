-- ===========================================================================
-- ADMIN · FINANCIERAS — gestión del catálogo de métodos de pago/financiación
-- ya existente (`payment_methods`/`payment_method_plans`), sin tablas
-- paralelas. Reutiliza el motor de fees, `sale_payment_allocations` (ya con
-- snapshots históricos) y `sale_financing_contracts` tal cual existen.
--
-- ÚNICO gap real encontrado en la inspección: `sale_payment_allocations` NO
-- guardaba si el método exigía contrato firmado AL MOMENTO de crear la
-- asignación — `mark_sale_sold` comparaba contra el valor ACTUAL de
-- `payment_methods.requires_signed_contract`. Si un admin cambiaba esa
-- configuración, una venta PENDING ya existente podía dejar de exigir (o
-- empezar a exigir) un contrato que nunca formó parte de su configuración
-- original. Se corrige con un snapshot nuevo + los 2 lugares que lo usaban.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Snapshot histórico que faltaba + columna de instrucciones operativas
--    (pedida explícitamente para financieras; `subtext` ya cubre la
--    "descripción" corta — instrucciones es contenido más largo/operativo).
-- ---------------------------------------------------------------------------
alter table public.payment_methods
  add column if not exists instructions text;

alter table public.sale_payment_allocations
  add column if not exists requires_signed_contract_snapshot boolean not null default false;

comment on column public.sale_payment_allocations.requires_signed_contract_snapshot is
  'Si el método exigía contrato firmado AL MOMENTO de crear/sincronizar esta asignación (mientras la venta era DRAFT). Nunca se recalcula después — es historia, no configuración actual. Ver mark_sale_sold.';

-- Backfill de filas existentes: mejor aproximación disponible es la
-- configuración ACTUAL del método (no hay un valor histórico más verdadero
-- para asignaciones creadas antes de que existiera esta columna).
update public.sale_payment_allocations a
set requires_signed_contract_snapshot = m.requires_signed_contract
from public.payment_methods m
where m.id = a.payment_method_id
  and a.requires_signed_contract_snapshot is distinct from m.requires_signed_contract;

-- ---------------------------------------------------------------------------
-- 2. sync_sale_payment_allocations — ahora también graba el snapshot nuevo.
-- ---------------------------------------------------------------------------
create or replace function public.sync_sale_payment_allocations(p_sale_id uuid, p_allocations jsonb)
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
      requires_signed_contract_snapshot,
      reference, notes)
    values (
      p_sale_id, v_method.id, v_plan.id, v_pos, v_mode,
      (v_settle->>'gross')::bigint, (v_settle->>'fee')::bigint, (v_settle->>'net')::bigint,
      coalesce(v_plan_bps, v_method.flat_fee_bps), v_method.flat_fee_cents,
      v_method.name, v_plan.label, v_method.fee_strategy,
      v_method.requires_signed_contract,
      nullif(v_a->>'reference', ''), nullif(v_a->>'notes', ''));

    v_pos := v_pos + 1;
  end loop;
end;
$$;
revoke all on function public.sync_sale_payment_allocations(uuid, jsonb) from public, anon;
grant execute on function public.sync_sale_payment_allocations(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. mark_sale_sold — el requisito de contrato ahora se lee del SNAPSHOT de
--    la asignación (config al momento de configurar el pago), NUNCA de la
--    config actual del método. Así TEST 5 (admin cambia el requisito
--    después) no afecta ventas cuya asignación ya se fijó.
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
    sale_total_cents     = v_sale_total,
    settlement_status    = 'PENDING_COLLECTION'
  where id = p_sale_id;

  insert into public.sale_status_history (sale_id, from_status, to_status, changed_by)
  values (p_sale_id, 'PENDING', 'SOLD', v_uid);

  return jsonb_build_object('ok', true, 'saleId', p_sale_id, 'saleNumber', v_number,
    'status', 'SOLD', 'saleTotalCents', v_sale_total);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. get_cuba_sale_draft — `methodRequiresSignedContract` ahora sale del
--    snapshot de la asignación (coincide EXACTO con lo que `mark_sale_sold`
--    realmente exige), no de la config actual del método.
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
                             'methodRequiresSignedContract', a.requires_signed_contract_snapshot,
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
                          ), '[]'::jsonb),
    'settlement', (
      select jsonb_build_object(
        'status', s.settlement_status,
        'closingReviewedAt', s.closing_reviewed_at,
        'closingReviewedByName', (select pr.full_name from public.profiles pr where pr.id = s.closing_reviewed_by),
        'amountCollectedCents', coalesce(live.collected_cents, 0),
        'amountOutstandingCents', greatest(0, coalesce(s.sale_total_cents, 0) - coalesce(live.collected_cents, 0)),
        'saleTotalCents', coalesce(s.sale_total_cents, 0),
        'readyForPaid', coalesce(live.all_covered, false)
                         and coalesce(s.sale_total_cents, 0) > 0
                         and coalesce(live.collected_cents, 0) = coalesce(s.sale_total_cents, 0)
      )
      from (
        select
          sum(case
                when m.method_type = 'FINANCING' then
                  case when exists (
                    select 1 from public.sale_financing_contracts c
                    where c.payment_allocation_id = a.id and c.status = 'ACCREDITED'
                  ) then a.net_amount_cents else 0 end
                else
                  case when a.settlement_status = 'SETTLED' then a.net_amount_cents else 0 end
              end) as collected_cents,
          bool_and(
            case
              when m.method_type = 'FINANCING' then exists (
                select 1 from public.sale_financing_contracts c
                where c.payment_allocation_id = a.id and c.status = 'ACCREDITED'
              )
              else a.settlement_status = 'SETTLED'
            end
          ) as all_covered
        from public.sale_payment_allocations a
        join public.payment_methods m on m.id = a.payment_method_id
        where a.sale_id = s.id
      ) live
    )
  )
  from public.sales s
  where s.id = p_sale_id;   -- RLS: solo ventas propias / admin
$$;

-- ===========================================================================
-- 5. payment_provider_events — auditoría enfocada de este módulo.
-- ===========================================================================
create table public.payment_provider_events (
  id           uuid primary key default gen_random_uuid(),
  provider_id  uuid not null references public.payment_methods (id) on delete cascade,
  plan_id      uuid references public.payment_method_plans (id) on delete set null,
  event_type   text not null check (event_type in (
                 'PROVIDER_CREATED', 'PROVIDER_UPDATED', 'PROVIDER_ACTIVATED', 'PROVIDER_DEACTIVATED',
                 'PLAN_CREATED', 'PLAN_UPDATED', 'PLAN_DEACTIVATED'
               )),
  actor_id     uuid references public.profiles (id) on delete set null,
  changes      jsonb,
  created_at   timestamptz not null default now()
);
create index payment_provider_events_provider_idx on public.payment_provider_events (provider_id, created_at desc);

alter table public.payment_provider_events enable row level security;
grant select on public.payment_provider_events to authenticated;
create policy payment_provider_events_select_admin on public.payment_provider_events
  for select to authenticated
  using (public.is_admin());

-- ===========================================================================
-- 6. RPCs de administración — ADMIN-only, auditadas. Nunca hard-delete.
-- ===========================================================================

create or replace function public.admin_create_payment_provider(
  p_legacy_id                  text,
  p_name                       text,
  p_method_type                text,
  p_subtext                    text default null,
  p_instructions               text default null,
  p_is_active                  boolean default true,
  p_position                   integer default 0,
  p_requires_signed_contract   boolean default false,
  p_only_florida               boolean default false,
  p_website_url                text default null,
  p_website_enabled            boolean default false,
  p_fee_strategy               text default 'NONE',
  p_flat_fee_bps               integer default null,
  p_flat_fee_cents             bigint default null,
  p_conditional_threshold_cents bigint default null,
  p_conditional_below_fee_cents bigint default null,
  p_conditional_above_fee_bps   integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
  v_code text := nullif(btrim(coalesce(p_legacy_id, '')), '');
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;
  if v_code is null or v_name is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;
  if p_method_type not in ('CARD', 'ZELLE', 'FINANCING', 'INTERNAL') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_TYPE');
  end if;
  if p_fee_strategy not in ('NONE', 'FLAT_RATE', 'FIXED_AMOUNT', 'FIXED_PLUS_PERCENT', 'INSTALLMENTS', 'CONDITIONAL') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_FEE_STRATEGY');
  end if;
  if exists (select 1 from public.payment_methods where legacy_id = v_code) then
    return jsonb_build_object('ok', false, 'code', 'CODE_ALREADY_EXISTS');
  end if;

  insert into public.payment_methods (
    legacy_id, name, method_type, subtext, instructions, is_active, position,
    requires_signed_contract, only_florida, website_url, website_enabled,
    fee_strategy, flat_fee_bps, flat_fee_cents,
    conditional_threshold_cents, conditional_below_fee_cents, conditional_above_fee_bps
  ) values (
    v_code, v_name, p_method_type, nullif(btrim(coalesce(p_subtext, '')), ''), nullif(btrim(coalesce(p_instructions, '')), ''),
    coalesce(p_is_active, true), coalesce(p_position, 0),
    coalesce(p_requires_signed_contract, false), coalesce(p_only_florida, false),
    nullif(btrim(coalesce(p_website_url, '')), ''), coalesce(p_website_enabled, false),
    p_fee_strategy, p_flat_fee_bps, p_flat_fee_cents,
    p_conditional_threshold_cents, p_conditional_below_fee_cents, p_conditional_above_fee_bps
  )
  returning id into v_id;

  insert into public.payment_provider_events (provider_id, event_type, actor_id, changes)
  values (v_id, 'PROVIDER_CREATED', v_uid, jsonb_build_object('name', v_name, 'methodType', p_method_type));

  return jsonb_build_object('ok', true, 'providerId', v_id);
end;
$$;
revoke all on function public.admin_create_payment_provider(text, text, text, text, text, boolean, integer, boolean, boolean, text, boolean, text, integer, bigint, bigint, bigint, integer) from public, anon;
grant execute on function public.admin_create_payment_provider(text, text, text, text, text, boolean, integer, boolean, boolean, text, boolean, text, integer, bigint, bigint, bigint, integer) to authenticated;

create or replace function public.admin_update_payment_provider(
  p_provider_id                uuid,
  p_name                       text,
  p_subtext                    text default null,
  p_instructions               text default null,
  p_position                   integer default 0,
  p_requires_signed_contract   boolean default false,
  p_only_florida               boolean default false,
  p_website_url                text default null,
  p_website_enabled            boolean default false,
  p_fee_strategy               text default 'NONE',
  p_flat_fee_bps               integer default null,
  p_flat_fee_cents             bigint default null,
  p_conditional_threshold_cents bigint default null,
  p_conditional_below_fee_cents bigint default null,
  p_conditional_above_fee_bps   integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_old public.payment_methods;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_changes jsonb := '{}'::jsonb;
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
  if p_fee_strategy not in ('NONE', 'FLAT_RATE', 'FIXED_AMOUNT', 'FIXED_PLUS_PERCENT', 'INSTALLMENTS', 'CONDITIONAL') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_FEE_STRATEGY');
  end if;

  select * into v_old from public.payment_methods where id = p_provider_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'PROVIDER_NOT_FOUND');
  end if;

  if v_old.name is distinct from v_name then
    v_changes := v_changes || jsonb_build_object('name', jsonb_build_object('from', v_old.name, 'to', v_name));
  end if;
  if v_old.requires_signed_contract is distinct from coalesce(p_requires_signed_contract, false) then
    v_changes := v_changes || jsonb_build_object('requiresSignedContract',
      jsonb_build_object('from', v_old.requires_signed_contract, 'to', coalesce(p_requires_signed_contract, false)));
  end if;
  if v_old.only_florida is distinct from coalesce(p_only_florida, false) then
    v_changes := v_changes || jsonb_build_object('onlyFlorida',
      jsonb_build_object('from', v_old.only_florida, 'to', coalesce(p_only_florida, false)));
  end if;
  if v_old.fee_strategy is distinct from p_fee_strategy
     or v_old.flat_fee_bps is distinct from p_flat_fee_bps
     or v_old.flat_fee_cents is distinct from p_flat_fee_cents
     or v_old.conditional_threshold_cents is distinct from p_conditional_threshold_cents
     or v_old.conditional_below_fee_cents is distinct from p_conditional_below_fee_cents
     or v_old.conditional_above_fee_bps is distinct from p_conditional_above_fee_bps then
    v_changes := v_changes || jsonb_build_object('fee', jsonb_build_object(
      'from', jsonb_build_object('strategy', v_old.fee_strategy, 'flatFeeBps', v_old.flat_fee_bps, 'flatFeeCents', v_old.flat_fee_cents),
      'to', jsonb_build_object('strategy', p_fee_strategy, 'flatFeeBps', p_flat_fee_bps, 'flatFeeCents', p_flat_fee_cents)));
  end if;

  update public.payment_methods set
    name = v_name,
    subtext = nullif(btrim(coalesce(p_subtext, '')), ''),
    instructions = nullif(btrim(coalesce(p_instructions, '')), ''),
    position = coalesce(p_position, 0),
    requires_signed_contract = coalesce(p_requires_signed_contract, false),
    only_florida = coalesce(p_only_florida, false),
    website_url = nullif(btrim(coalesce(p_website_url, '')), ''),
    website_enabled = coalesce(p_website_enabled, false),
    fee_strategy = p_fee_strategy,
    flat_fee_bps = p_flat_fee_bps,
    flat_fee_cents = p_flat_fee_cents,
    conditional_threshold_cents = p_conditional_threshold_cents,
    conditional_below_fee_cents = p_conditional_below_fee_cents,
    conditional_above_fee_bps = p_conditional_above_fee_bps
  where id = p_provider_id;

  if v_changes <> '{}'::jsonb then
    insert into public.payment_provider_events (provider_id, event_type, actor_id, changes)
    values (p_provider_id, 'PROVIDER_UPDATED', v_uid, v_changes);
  end if;

  return jsonb_build_object('ok', true, 'providerId', p_provider_id);
end;
$$;
revoke all on function public.admin_update_payment_provider(uuid, text, text, text, integer, boolean, boolean, text, boolean, text, integer, bigint, bigint, bigint, integer) from public, anon;
grant execute on function public.admin_update_payment_provider(uuid, text, text, text, integer, boolean, boolean, text, boolean, text, integer, bigint, bigint, bigint, integer) to authenticated;

create or replace function public.admin_set_payment_provider_active(p_provider_id uuid, p_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_old public.payment_methods;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  select * into v_old from public.payment_methods where id = p_provider_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'PROVIDER_NOT_FOUND');
  end if;
  if v_old.is_active = coalesce(p_active, true) then
    return jsonb_build_object('ok', true, 'providerId', p_provider_id, 'isActive', v_old.is_active);
  end if;

  update public.payment_methods set is_active = coalesce(p_active, true) where id = p_provider_id;

  insert into public.payment_provider_events (provider_id, event_type, actor_id)
  values (p_provider_id, case when coalesce(p_active, true) then 'PROVIDER_ACTIVATED' else 'PROVIDER_DEACTIVATED' end, v_uid);

  return jsonb_build_object('ok', true, 'providerId', p_provider_id, 'isActive', coalesce(p_active, true));
end;
$$;
revoke all on function public.admin_set_payment_provider_active(uuid, boolean) from public, anon;
grant execute on function public.admin_set_payment_provider_active(uuid, boolean) to authenticated;

create or replace function public.admin_create_payment_plan(
  p_provider_id uuid, p_label text, p_term_months integer default null,
  p_fee_bps integer default 0, p_position integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
  v_pos integer;
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
  if not exists (select 1 from public.payment_methods where id = p_provider_id) then
    return jsonb_build_object('ok', false, 'code', 'PROVIDER_NOT_FOUND');
  end if;

  v_pos := coalesce(p_position, (select coalesce(max(position), -1) + 1 from public.payment_method_plans where payment_method_id = p_provider_id));

  insert into public.payment_method_plans (payment_method_id, label, term_months, fee_bps, position, is_active)
  values (p_provider_id, v_label, p_term_months, coalesce(p_fee_bps, 0), v_pos, true)
  returning id into v_id;

  insert into public.payment_provider_events (provider_id, plan_id, event_type, actor_id, changes)
  values (p_provider_id, v_id, 'PLAN_CREATED', v_uid, jsonb_build_object('label', v_label, 'feeBps', p_fee_bps, 'termMonths', p_term_months));

  return jsonb_build_object('ok', true, 'planId', v_id);
end;
$$;
revoke all on function public.admin_create_payment_plan(uuid, text, integer, integer, integer) from public, anon;
grant execute on function public.admin_create_payment_plan(uuid, text, integer, integer, integer) to authenticated;

create or replace function public.admin_update_payment_plan(
  p_plan_id uuid, p_label text, p_term_months integer default null, p_fee_bps integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_old public.payment_method_plans;
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
  v_changes jsonb := '{}'::jsonb;
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

  select * into v_old from public.payment_method_plans where id = p_plan_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'PLAN_NOT_FOUND');
  end if;

  if v_old.label is distinct from v_label or v_old.fee_bps is distinct from coalesce(p_fee_bps, 0)
     or v_old.term_months is distinct from p_term_months then
    v_changes := jsonb_build_object(
      'from', jsonb_build_object('label', v_old.label, 'feeBps', v_old.fee_bps, 'termMonths', v_old.term_months),
      'to', jsonb_build_object('label', v_label, 'feeBps', coalesce(p_fee_bps, 0), 'termMonths', p_term_months));
  end if;

  update public.payment_method_plans set
    label = v_label, term_months = p_term_months, fee_bps = coalesce(p_fee_bps, 0)
  where id = p_plan_id;

  if v_changes <> '{}'::jsonb then
    insert into public.payment_provider_events (provider_id, plan_id, event_type, actor_id, changes)
    values (v_old.payment_method_id, p_plan_id, 'PLAN_UPDATED', v_uid, v_changes);
  end if;

  return jsonb_build_object('ok', true, 'planId', p_plan_id);
end;
$$;
revoke all on function public.admin_update_payment_plan(uuid, text, integer, integer) from public, anon;
grant execute on function public.admin_update_payment_plan(uuid, text, integer, integer) to authenticated;

create or replace function public.admin_set_payment_plan_active(p_plan_id uuid, p_active boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_old public.payment_method_plans;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  select * into v_old from public.payment_method_plans where id = p_plan_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'PLAN_NOT_FOUND');
  end if;
  if v_old.is_active = coalesce(p_active, true) then
    return jsonb_build_object('ok', true, 'planId', p_plan_id, 'isActive', v_old.is_active);
  end if;

  update public.payment_method_plans set is_active = coalesce(p_active, true) where id = p_plan_id;

  insert into public.payment_provider_events (provider_id, plan_id, event_type, actor_id)
  values (v_old.payment_method_id, p_plan_id, case when coalesce(p_active, true) then 'PLAN_UPDATED' else 'PLAN_DEACTIVATED' end, v_uid);

  return jsonb_build_object('ok', true, 'planId', p_plan_id, 'isActive', coalesce(p_active, true));
end;
$$;
revoke all on function public.admin_set_payment_plan_active(uuid, boolean) from public, anon;
grant execute on function public.admin_set_payment_plan_active(uuid, boolean) to authenticated;

create or replace function public.admin_reorder_payment_plans(p_provider_id uuid, p_ordered_plan_ids uuid[])
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
  if not exists (select 1 from public.payment_methods where id = p_provider_id) then
    return jsonb_build_object('ok', false, 'code', 'PROVIDER_NOT_FOUND');
  end if;

  foreach v_id in array coalesce(p_ordered_plan_ids, array[]::uuid[]) loop
    update public.payment_method_plans set position = v_pos
    where id = v_id and payment_method_id = p_provider_id;
    v_pos := v_pos + 1;
  end loop;

  return jsonb_build_object('ok', true, 'providerId', p_provider_id);
end;
$$;
revoke all on function public.admin_reorder_payment_plans(uuid, uuid[]) from public, anon;
grant execute on function public.admin_reorder_payment_plans(uuid, uuid[]) to authenticated;

-- ===========================================================================
-- 7. admin_payment_provider_list — listado con uso real (ADMIN).
-- ===========================================================================
create or replace function public.admin_payment_provider_list(
  p_search   text default null,
  p_type     text default 'ALL',
  p_status   text default 'ALL',
  p_contract text default 'ALL'
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_type   text := coalesce(nullif(upper(btrim(p_type)), ''), 'ALL');
  v_status text := coalesce(nullif(upper(btrim(p_status)), ''), 'ALL');
  v_contract text := coalesce(nullif(upper(btrim(p_contract)), ''), 'ALL');
  v_result jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  with base as (
    select m.*
    from public.payment_methods m
    where (v_type = 'ALL' or m.method_type = v_type)
      and (v_status = 'ALL' or (v_status = 'ACTIVE' and m.is_active) or (v_status = 'INACTIVE' and not m.is_active))
      and (v_contract = 'ALL' or (v_contract = 'REQUIRED' and m.requires_signed_contract) or (v_contract = 'NOT_REQUIRED' and not m.requires_signed_contract))
      and (
        v_search is null
        or m.name ilike '%' || v_search || '%'
        or m.legacy_id ilike '%' || v_search || '%'
        or coalesce(m.subtext, '') ilike '%' || v_search || '%'
      )
  )
  select jsonb_build_object(
    'ok', true,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'providerId', b.id,
        'legacyId', b.legacy_id,
        'name', b.name,
        'methodType', b.method_type,
        'isActive', b.is_active,
        'feeStrategy', b.fee_strategy,
        'flatFeeBps', b.flat_fee_bps,
        'flatFeeCents', b.flat_fee_cents,
        'requiresSignedContract', b.requires_signed_contract,
        'onlyFlorida', b.only_florida,
        'planCount', (select count(*) from public.payment_method_plans p where p.payment_method_id = b.id and p.is_active),
        'salesUsingCount', (select count(*) from public.sale_payment_allocations a where a.payment_method_id = b.id)
      ) order by b.position, b.name)
      from base b
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;
revoke all on function public.admin_payment_provider_list(text, text, text, text) from public, anon;
grant execute on function public.admin_payment_provider_list(text, text, text, text) to authenticated;

-- ===========================================================================
-- 8. admin_payment_provider_detail — ficha completa (ADMIN).
-- ===========================================================================
create or replace function public.admin_payment_provider_detail(p_provider_id uuid)
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
  if not exists (select 1 from public.payment_methods where id = p_provider_id) then
    return jsonb_build_object('ok', false, 'code', 'PROVIDER_NOT_FOUND');
  end if;

  select jsonb_build_object(
    'ok', true,
    'provider', (select to_jsonb(m.*) from public.payment_methods m where m.id = p_provider_id),
    'plans', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'label', p.label, 'termMonths', p.term_months, 'feeBps', p.fee_bps,
        'isActive', p.is_active, 'position', p.position,
        'salesUsingCount', (select count(*) from public.sale_payment_allocations a where a.payment_method_plan_id = p.id)
      ) order by p.position)
      from public.payment_method_plans p where p.payment_method_id = p_provider_id
    ), '[]'::jsonb),
    'usage', (
      select jsonb_build_object(
        'salesCount', count(distinct a.sale_id),
        'grossAllocatedCents', coalesce(sum(a.gross_amount_cents), 0),
        'netAccreditedCents', coalesce(sum(a.net_amount_cents) filter (
          where (select c.status from public.sale_financing_contracts c where c.payment_allocation_id = a.id) = 'ACCREDITED'
             or (select m2.method_type from public.payment_methods m2 where m2.id = a.payment_method_id) <> 'FINANCING'
        ), 0),
        'contractsSent', (select count(*) from public.sale_financing_contracts c where c.payment_method_id = p_provider_id and c.status = 'SENT'),
        'contractsSigned', (select count(*) from public.sale_financing_contracts c where c.payment_method_id = p_provider_id and c.status = 'SIGNED'),
        'contractsAccredited', (select count(*) from public.sale_financing_contracts c where c.payment_method_id = p_provider_id and c.status = 'ACCREDITED')
      )
      from public.sale_payment_allocations a
      where a.payment_method_id = p_provider_id
    ),
    'recentEvents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'eventType', e.event_type,
        'actorName', (select pr.full_name from public.profiles pr where pr.id = e.actor_id),
        'planLabel', (select pl.label from public.payment_method_plans pl where pl.id = e.plan_id),
        'changes', e.changes,
        'createdAt', e.created_at
      ) order by e.created_at desc)
      from (
        select * from public.payment_provider_events
        where provider_id = p_provider_id
        order by created_at desc
        limit 25
      ) e
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;
revoke all on function public.admin_payment_provider_detail(uuid) from public, anon;
grant execute on function public.admin_payment_provider_detail(uuid) to authenticated;
