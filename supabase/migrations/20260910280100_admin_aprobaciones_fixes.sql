-- Corrige un bug real encontrado en la validación temprana con base de
-- datos real: `sale_edit_snapshot` devuelve un ÚNICO valor `jsonb` (con
-- claves `ok`/`payload`/`flat`), no una fila con columnas — las 3 llamadas
-- que hacían `select flat into v_flat from public.sale_edit_snapshot(...)`
-- fallaban con "column flat does not exist". Se corrige a
-- `public.sale_edit_snapshot(...) -> 'flat'` (y `-> 'payload'`) en las 3.
-- Ningún otro cambio de comportamiento.

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
  v_snapshot jsonb;
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

  v_snapshot := public.sale_edit_snapshot(v_req.sale_id);
  v_payload := v_snapshot->'payload';
  v_flat := v_snapshot->'flat';

  for v_entry in select * from jsonb_array_elements(v_req.requested_changes) loop
    v_path := v_entry->>'path';
    v_current := v_flat->>v_path;
    if coalesce(v_entry->>'oldValue', '') is distinct from coalesce(v_current, '') then
      return jsonb_build_object('ok', false, 'code', 'REQUEST_CONFLICT',
        'path', v_path, 'currentValue', v_current, 'declaredOldValue', v_entry->>'oldValue');
    end if;
  end loop;

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

create or replace function public.admin_edit_request_detail(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_req public.sale_edit_requests;
  v_snapshot jsonb;
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

  v_snapshot := public.sale_edit_snapshot(v_req.sale_id);
  v_flat := v_snapshot->'flat';

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
