-- ---------------------------------------------------------------------------
-- FINANCIAMIENTOS EDITABLES — administración y vendedor.
--
-- Hasta ahora las asignaciones de pago solo se podían tocar mientras la venta
-- era un BORRADOR (política `sale_is_own_draft`), y el editor administrativo
-- ni siquiera las incluía. Si se elegía mal la financiera o el plan, no había
-- forma de corregirlo.
--
-- Por qué no bastaba con abrir el motor que ya existía: `sync_sale_payment_
-- allocations` BORRA todas las asignaciones de la venta y las vuelve a crear
-- con ids nuevos. Como `sale_financing_contracts.payment_allocation_id` tiene
-- `on delete cascade`, eso habría borrado en silencio los contratos de
-- financiera —con su PDF, sus fechas y su historial— y habría cambiado el
-- dinero cobrado sin dejar rastro.
--
-- Aquí el motor ACTUALIZA EN SU SITIO: los ids se conservan, los contratos
-- sobreviven, y todo cambio queda en `sale_change_history`.
--
-- La única regla que se mantiene intacta (regla de negocio del dueño): el
-- dinero que YA ENTRÓ —contrato ACREDITADO o asignación LIQUIDADA— no se
-- reescribe en silencio. Se deshace con un acto explícito y registrado
-- (`admin_void_financing_contract` / `admin_unsettle_payment_allocation`) y
-- recién entonces se puede cambiar. Nunca se inventan pagos para cuadrar.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Un contrato se puede ANULAR (antes solo SENT → SIGNED → ACCREDITED)
-- ---------------------------------------------------------------------------
alter table public.sale_financing_contracts
  drop constraint if exists sale_financing_contracts_status_check;
alter table public.sale_financing_contracts
  add constraint sale_financing_contracts_status_check
  check (status in ('SENT', 'SIGNED', 'ACCREDITED', 'VOID'));

alter table public.sale_financing_contracts
  add column if not exists voided_at   timestamptz,
  add column if not exists voided_by   uuid references public.profiles (id) on delete set null,
  add column if not exists void_reason text;

comment on column public.sale_financing_contracts.void_reason is
  'Por qué se anuló el contrato. Un contrato VOID deja de contar como dinero acreditado (ver sale_settlement_amounts).';

-- ---------------------------------------------------------------------------
-- 2. ¿Está el dinero de esta asignación fuera de discusión?
--    null = libre; el resto indica QUÉ la bloquea.
-- ---------------------------------------------------------------------------
create or replace function public._allocation_money_lock(p_allocation_id uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select case
    when exists (
      select 1 from public.sale_financing_contracts c
       where c.payment_allocation_id = p_allocation_id and c.status = 'ACCREDITED')
      then 'ACCREDITED'
    when exists (
      select 1 from public.sale_payment_allocations a
       where a.id = p_allocation_id and a.settlement_status = 'SETTLED')
      then 'SETTLED'
    when exists (
      select 1 from public.sale_financing_contracts c
       where c.payment_allocation_id = p_allocation_id and c.status = 'SIGNED')
      then 'SIGNED'
    when exists (
      select 1 from public.sale_financing_contracts c
       where c.payment_allocation_id = p_allocation_id and c.status = 'SENT')
      then 'SENT'
    else null
  end;
$$;

revoke all on function public._allocation_money_lock(uuid) from public, anon;
grant execute on function public._allocation_money_lock(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Anular un contrato emitido (ADMIN). Deja de contar como acreditado y la
--    asignación vuelve a ser editable.
-- ---------------------------------------------------------------------------
create or replace function public.admin_void_financing_contract(
  p_contract_id uuid,
  p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_reason   text := btrim(coalesce(p_reason, ''));
  v_contract public.sale_financing_contracts;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;
  if length(v_reason) < 3 then
    return jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
  end if;

  select * into v_contract from public.sale_financing_contracts
   where id = p_contract_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'CONTRACT_NOT_FOUND');
  end if;
  if v_contract.status = 'VOID' then
    return jsonb_build_object('ok', true, 'alreadyVoid', true);
  end if;

  update public.sale_financing_contracts
     set status = 'VOID', voided_at = now(), voided_by = v_uid,
         void_reason = left(v_reason, 500), updated_at = now()
   where id = p_contract_id;

  insert into public.financing_contract_events (contract_id, from_status, to_status, changed_by, note)
  values (p_contract_id, v_contract.status, 'VOID', v_uid, left(v_reason, 500));

  -- Queda también en el historial de la venta, que es donde se mira.
  perform public.log_sale_field_change(
    gen_random_uuid(), v_contract.sale_id, v_uid, v_reason,
    'payments.' || v_contract.payment_allocation_id::text || '.contract',
    'UPDATE', v_contract.status, 'VOID');

  return jsonb_build_object(
    'ok', true,
    'saleId', v_contract.sale_id,
    'allocationId', v_contract.payment_allocation_id,
    'fromStatus', v_contract.status);
end;
$$;

revoke all on function public.admin_void_financing_contract(uuid, text) from public, anon;
grant execute on function public.admin_void_financing_contract(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Deshacer la liquidación de un pago directo (ADMIN).
-- ---------------------------------------------------------------------------
create or replace function public.admin_unsettle_payment_allocation(
  p_allocation_id uuid,
  p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_alloc  public.sale_payment_allocations;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;
  if length(v_reason) < 3 then
    return jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
  end if;

  select * into v_alloc from public.sale_payment_allocations
   where id = p_allocation_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'ALLOCATION_NOT_FOUND');
  end if;
  if v_alloc.settlement_status <> 'SETTLED' then
    return jsonb_build_object('ok', true, 'alreadyPending', true);
  end if;

  update public.sale_payment_allocations
     set settlement_status = 'PENDING', settled_at = null, settled_by = null,
         updated_at = now()
   where id = p_allocation_id;

  perform public.log_sale_field_change(
    gen_random_uuid(), v_alloc.sale_id, v_uid, v_reason,
    'payments.' || p_allocation_id::text || '.settlement',
    'UPDATE', 'SETTLED', 'PENDING');

  return jsonb_build_object('ok', true, 'saleId', v_alloc.sale_id);
end;
$$;

revoke all on function public.admin_unsettle_payment_allocation(uuid, text) from public, anon;
grant execute on function public.admin_unsettle_payment_allocation(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Guardar los financiamientos de una venta.
--
--    Quién: el ADMIN en cualquier venta, y el VENDEDOR en las suyas (mientras
--    no estén PAGADAS). Las barandillas son POR ASIGNACIÓN, no por rol: lo
--    que tiene dinero dentro está bloqueado para los dos hasta que un admin lo
--    deshaga explícitamente.
--
--    Todo o nada: si algo está bloqueado no se aplica NADA y se devuelve la
--    lista con el motivo, para poder explicarlo en pantalla.
-- ---------------------------------------------------------------------------
create or replace function public.set_sale_payment_allocations(
  p_sale_id uuid,
  p_allocations jsonb,
  p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_admin   boolean := public.is_admin();
  v_reason  text := btrim(coalesce(p_reason, ''));
  v_sale    public.sales;
  v_arr     jsonb := case when jsonb_typeof(p_allocations) = 'array'
                          then p_allocations else '[]'::jsonb end;
  v_a       jsonb;
  v_id      uuid;
  v_ids     uuid[] := array[]::uuid[];
  v_old     public.sale_payment_allocations;
  v_method  public.payment_methods;
  v_plan    public.payment_method_plans;
  v_plan_bps integer;
  v_mode    text;
  v_amount  bigint;
  v_settle  jsonb;
  v_lock    text;
  v_blocked jsonb := '[]'::jsonb;
  v_group   uuid := gen_random_uuid();
  v_pos     int := 0;
  v_added   int := 0;
  v_updated int := 0;
  v_removed int := 0;
  v_voided  int := 0;
  v_money_change boolean;
  v_contract public.sale_financing_contracts;
  v_total   bigint;
  v_units_total  bigint;
  v_extras_total bigint;
  v_alloc_net bigint;
  v_collected bigint;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if length(v_reason) < 3 then
    return jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
  end if;

  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'SALE_NOT_FOUND');
  end if;
  if not v_admin and v_sale.seller_id <> v_uid then
    return jsonb_build_object('ok', false, 'code', 'NOT_OWNER');
  end if;
  -- Una venta PAGADA solo la toca administración (y aun así, el dinero que ya
  -- entró sigue bloqueado por las barandillas de abajo).
  if v_sale.status = 'PAID' and not v_admin then
    return jsonb_build_object('ok', false, 'code', 'SALE_PAID');
  end if;

  -- ------------------------------------------------------------ 1.ª pasada:
  -- comprobar TODO antes de tocar nada.
  for v_a in select * from jsonb_array_elements(v_arr) loop
    v_id := nullif(v_a->>'id', '')::uuid;
    if v_id is null then
      continue; -- alta: nada que bloquear
    end if;
    v_ids := array_append(v_ids, v_id);

    select * into v_old from public.sale_payment_allocations
     where id = v_id and sale_id = p_sale_id;
    if not found then
      v_blocked := v_blocked || jsonb_build_object(
        'allocationId', v_id, 'code', 'ALLOCATION_NOT_IN_SALE');
      continue;
    end if;

    -- ¿Cambia el dinero, o solo la referencia/nota?
    v_money_change :=
         v_old.payment_method_id is distinct from nullif(v_a->>'paymentMethodId', '')::uuid
      or v_old.payment_method_plan_id is distinct from nullif(v_a->>'planId', '')::uuid
      or v_old.input_mode is distinct from (case when upper(coalesce(v_a->>'inputMode', 'GROSS')) = 'NET' then 'NET' else 'GROSS' end)
      or (case when upper(coalesce(v_a->>'inputMode', 'GROSS')) = 'NET' then v_old.net_amount_cents else v_old.gross_amount_cents end)
         is distinct from greatest(0, coalesce((v_a->>'amountCents')::bigint, 0));

    if not v_money_change then
      continue;
    end if;

    v_lock := public._allocation_money_lock(v_id);
    if v_lock in ('ACCREDITED', 'SETTLED') then
      -- Dinero que ya entró: no se reescribe en silencio, ni para el admin.
      v_blocked := v_blocked || jsonb_build_object(
        'allocationId', v_id, 'code', 'MONEY_ALREADY_IN', 'lock', v_lock);
    elsif v_lock in ('SENT', 'SIGNED') then
      -- Hay un contrato emitido en la financiera: cambiarlo lo invalida, así
      -- que hay que decirlo a propósito (y solo el admin puede anularlo).
      if coalesce((v_a->>'voidContract')::boolean, false) and v_admin then
        null; -- se anula en la 2.ª pasada
      else
        v_blocked := v_blocked || jsonb_build_object(
          'allocationId', v_id, 'code', 'CONTRACT_EMITTED', 'lock', v_lock);
      end if;
    end if;
  end loop;

  -- Bajas: lo que ya no viene en la lista.
  for v_old in select * from public.sale_payment_allocations where sale_id = p_sale_id loop
    if v_old.id = any(v_ids) then
      continue;
    end if;
    v_lock := public._allocation_money_lock(v_old.id);
    if v_lock is not null then
      v_blocked := v_blocked || jsonb_build_object(
        'allocationId', v_old.id, 'code',
        case when v_lock in ('ACCREDITED', 'SETTLED') then 'MONEY_ALREADY_IN' else 'CONTRACT_EMITTED' end,
        'lock', v_lock, 'removal', true);
    end if;
  end loop;

  if jsonb_array_length(v_blocked) > 0 then
    return jsonb_build_object('ok', false, 'code', 'ALLOCATION_LOCKED', 'blocked', v_blocked);
  end if;

  -- Si es administración tocando la venta de otro, el cambio cuenta como
  -- edición administrativa: el vendedor recibe su notificación, como con
  -- cualquier otra corrección.
  if v_admin and v_sale.seller_id <> v_uid then
    perform set_config('motods.edit_kind',
      case when v_sale.status = 'PAID' then 'ADMIN_CORRECTION' else 'ADMIN_EDIT' end, true);
  end if;

  -- ------------------------------------------------------------ 2.ª pasada:
  -- aplicar. Nada de borrar y recrear: los ids (y sus contratos) se conservan.
  for v_a in select * from jsonb_array_elements(v_arr) loop
    select * into v_method from public.payment_methods
     where id = nullif(v_a->>'paymentMethodId', '')::uuid and is_active;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'PAYMENT_METHOD_INVALID');
    end if;

    v_plan := null;
    v_plan_bps := null;
    if nullif(v_a->>'planId', '') is not null then
      select * into v_plan from public.payment_method_plans
       where id = (v_a->>'planId')::uuid and payment_method_id = v_method.id;
      if not found then
        return jsonb_build_object('ok', false, 'code', 'PLAN_INVALID');
      end if;
      v_plan_bps := v_plan.fee_bps;
    end if;

    v_mode := case when upper(coalesce(v_a->>'inputMode', 'GROSS')) = 'NET' then 'NET' else 'GROSS' end;
    v_amount := greatest(0, coalesce((v_a->>'amountCents')::bigint, 0));
    v_settle := public.payment_fee_settlement(
      v_method.fee_strategy, v_mode, v_amount,
      v_method.flat_fee_bps, v_method.flat_fee_cents, v_plan_bps,
      v_method.conditional_threshold_cents, v_method.conditional_below_fee_cents,
      v_method.conditional_above_fee_bps);

    v_id := nullif(v_a->>'id', '')::uuid;

    if v_id is null then
      insert into public.sale_payment_allocations (
        sale_id, payment_method_id, payment_method_plan_id, position, input_mode,
        gross_amount_cents, fee_amount_cents, net_amount_cents,
        fee_bps_snapshot, fixed_fee_cents_snapshot,
        provider_name_snapshot, plan_label_snapshot, fee_strategy_snapshot,
        requires_signed_contract_snapshot, reference, notes)
      values (
        p_sale_id, v_method.id, v_plan.id, v_pos, v_mode,
        (v_settle->>'gross')::bigint, (v_settle->>'fee')::bigint, (v_settle->>'net')::bigint,
        coalesce(v_plan_bps, v_method.flat_fee_bps), v_method.flat_fee_cents,
        v_method.name, v_plan.label, v_method.fee_strategy,
        v_method.requires_signed_contract,
        nullif(v_a->>'reference', ''), nullif(v_a->>'notes', ''))
      returning id into v_id;
      -- La recién creada también se conserva: si no, la pasada de bajas de
      -- más abajo borraría justo lo que se acaba de dar de alta.
      v_ids := array_append(v_ids, v_id);
      v_added := v_added + 1;
      perform public.log_sale_field_change(
        v_group, p_sale_id, v_uid, v_reason, 'payments.' || v_id::text, 'ADD',
        null, v_method.name || coalesce(' · ' || v_plan.label, '') || ' · ' || ((v_settle->>'net')::bigint / 100.0)::text);
    else
      select * into v_old from public.sale_payment_allocations where id = v_id;

      -- Contrato emitido que el admin decidió anular: se anula ANTES de
      -- cambiar la asignación, con su registro.
      if coalesce((v_a->>'voidContract')::boolean, false) then
        for v_contract in
          select * from public.sale_financing_contracts
           where payment_allocation_id = v_id and status in ('SENT', 'SIGNED')
        loop
          perform public.admin_void_financing_contract(v_contract.id, v_reason);
          v_voided := v_voided + 1;
        end loop;
      end if;

      update public.sale_payment_allocations set
        payment_method_id = v_method.id,
        payment_method_plan_id = v_plan.id,
        position = v_pos,
        input_mode = v_mode,
        gross_amount_cents = (v_settle->>'gross')::bigint,
        fee_amount_cents = (v_settle->>'fee')::bigint,
        net_amount_cents = (v_settle->>'net')::bigint,
        fee_bps_snapshot = coalesce(v_plan_bps, v_method.flat_fee_bps),
        fixed_fee_cents_snapshot = v_method.flat_fee_cents,
        provider_name_snapshot = v_method.name,
        plan_label_snapshot = v_plan.label,
        fee_strategy_snapshot = v_method.fee_strategy,
        requires_signed_contract_snapshot = v_method.requires_signed_contract,
        reference = nullif(v_a->>'reference', ''),
        notes = nullif(v_a->>'notes', ''),
        updated_at = now()
      where id = v_id;
      v_updated := v_updated + 1;

      perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason,
        'payments.' || v_id::text || '.provider', 'UPDATE',
        v_old.provider_name_snapshot, v_method.name);
      perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason,
        'payments.' || v_id::text || '.plan', 'UPDATE',
        v_old.plan_label_snapshot, v_plan.label);
      perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason,
        'payments.' || v_id::text || '.net_amount_cents', 'UPDATE',
        v_old.net_amount_cents::text, (v_settle->>'net'));
      perform public.log_sale_field_change(v_group, p_sale_id, v_uid, v_reason,
        'payments.' || v_id::text || '.reference', 'UPDATE',
        v_old.reference, nullif(v_a->>'reference', ''));
    end if;

    v_pos := v_pos + 1;
  end loop;

  -- Bajas (ya comprobadas: ninguna tiene contrato ni dinero dentro).
  for v_old in select * from public.sale_payment_allocations where sale_id = p_sale_id loop
    if v_old.id = any(v_ids) then
      continue;
    end if;
    perform public.log_sale_field_change(
      v_group, p_sale_id, v_uid, v_reason, 'payments.' || v_old.id::text, 'REMOVE',
      v_old.provider_name_snapshot || ' · ' || (v_old.net_amount_cents / 100.0)::text, null);
    delete from public.sale_payment_allocations where id = v_old.id;
    v_removed := v_removed + 1;
  end loop;

  -- ------------------------------------------------------ señal de cuadre
  select coalesce(sum(net_amount_cents), 0) into v_alloc_net
    from public.sale_payment_allocations where sale_id = p_sale_id;
  select collected_cents into v_collected from public.sale_settlement_amounts(p_sale_id);
  -- El total autoritativo se arma igual que en el motor de edición: la
  -- columna  solo se fija al confirmar la venta.
  select coalesce(sum(greatest(0, agreed_price_cents)), 0) into v_units_total
    from public.sale_units where sale_id = p_sale_id;
  select coalesce(sum(greatest(1, quantity) * greatest(0, unit_price_cents)), 0) into v_extras_total
    from public.sale_extras where sale_id = p_sale_id;
  v_total := v_units_total + v_extras_total + coalesce(v_sale.delivery_total_cents, 0);

  return jsonb_build_object(
    'ok', true,
    'saleId', p_sale_id,
    'added', v_added,
    'updated', v_updated,
    'removed', v_removed,
    'contractsVoided', v_voided,
    'editGroup', v_group,
    'reconciliation', jsonb_build_object(
      'balanced', v_alloc_net = v_total,
      'saleTotalCents', v_total,
      'allocatedNetCents', v_alloc_net,
      'collectedCents', coalesce(v_collected, 0),
      'differenceCents', v_alloc_net - v_total));
end;
$$;

revoke all on function public.set_sale_payment_allocations(uuid, jsonb, text) from public, anon;
grant execute on function public.set_sale_payment_allocations(uuid, jsonb, text) to authenticated;
