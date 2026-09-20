-- ===========================================================================
-- NOTIFICACIONES — endurecimiento (sin rediseño; mismas reglas de negocio).
--
-- 1. AISLAMIENTO DE PRUEBAS (partición "sandbox"):
--    `profiles.is_sandbox` marca EXPLÍCITAMENTE las cuentas de pruebas
--    automatizadas (no se deduce del correo). Solo lo fija el servidor de
--    confianza (service role / SQL sin sesión de usuario); ni el usuario ni un
--    admin pueden cambiarlo desde la app.
--      · El reparto a admins sigue siendo "todos los admins activos", pero de
--        la MISMA partición que el vendedor del evento: la actividad de un
--        vendedor real llega a todos los admins reales (sin cambios); la de
--        una cuenta de prueba, solo a admins de prueba.
--      · Un actor sandbox nunca notifica a un usuario real.
--      · Una cuenta invitada por un admin sandbox hereda la marca.
--    Así, un admin real nunca ve notificaciones, toasts ni contadores de
--    pruebas mientras éstas corren.
--
-- 2. EVENTOS DE DOMINIO REALES SOLAMENTE: los triggers notifican solo si
--      · hay una sesión de usuario autenticada (auth.uid()): las migraciones,
--        backfills y scripts de servicio NO notifican;
--      · el evento es actual (no una fila histórica reinsertada: más de 10
--        minutos antes de la transacción no notifica);
--      · no se pidió silencio explícito con el GUC de transacción
--        `motods.suppress_notifications = 'on'` (para mantenimiento hecho con
--        sesión de usuario). Los clientes no pueden fijar GUC (PostgREST solo
--        expone funciones del esquema public).
--
-- 3. FALLOS OBSERVABLES: si crear una notificación falla, la operación de
--    negocio sigue (como hasta ahora) y el fallo queda en
--    `notification_delivery_errors` (visible para admins) además del WARNING
--    en los logs de Postgres.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. profiles.is_sandbox + guardia
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists is_sandbox boolean not null default false;
comment on column public.profiles.is_sandbox is
  'Cuenta de pruebas automatizadas. Sus notificaciones quedan dentro de la partición sandbox (nunca llegan a usuarios reales). Solo la fija el servidor de confianza.';

create or replace function public.protect_profile_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Excepción MUY puntual: `accept_seller_invitation` (más abajo) activa la
  -- PROPIA cuenta del vendedor tras fijar su contraseña — una transición
  -- legítima e intencional que no pasa por is_admin(). Se habilita con un GUC
  -- de transacción (`set_config(..., is_local => true)`, nunca sobrevive más
  -- allá del `COMMIT` de esa RPC) que solo esa función activa — nunca algo
  -- que el cliente pueda fijar por su cuenta.
  if not public.is_admin()
     and coalesce(current_setting('motods.bypass_profile_guard', true), '') <> 'on' then
    new.role                := old.role;
    new.is_active            := old.is_active;
    new.account_status       := old.account_status;
    new.invited_by           := old.invited_by;
    new.invited_at           := old.invited_at;
    new.suspended_at         := old.suspended_at;
    new.suspended_by         := old.suspended_by;
    new.suspension_reason    := old.suspension_reason;
    new.reactivated_at       := old.reactivated_at;
    new.reactivated_by       := old.reactivated_by;
  end if;
  -- is_sandbox: solo el servidor de confianza (sin sesión de usuario: service
  -- role / SQL) o la herencia de la invitación (GUC de transacción que solo
  -- activa `admin_record_seller_invitation`). Ni siquiera un admin lo cambia.
  if auth.uid() is not null
     and coalesce(current_setting('motods.allow_sandbox_change', true), '') <> 'on' then
    new.is_sandbox := old.is_sandbox;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Registro de fallos de notificación (observabilidad)
-- ---------------------------------------------------------------------------
create table if not exists public.notification_delivery_errors (
  id         uuid primary key default gen_random_uuid(),
  source     text not null,
  sqlstate   text,
  message    text,
  context    jsonb,
  created_at timestamptz not null default now()
);
comment on table public.notification_delivery_errors is
  'Fallos al crear notificaciones. La operación de negocio siguió igual; aquí queda constancia para revisar. Solo admins leen.';
create index if not exists notification_delivery_errors_created_idx
  on public.notification_delivery_errors (created_at desc);

alter table public.notification_delivery_errors enable row level security;
revoke all on public.notification_delivery_errors from public, anon, authenticated;
grant select on public.notification_delivery_errors to authenticated;
drop policy if exists notification_delivery_errors_select_admin on public.notification_delivery_errors;
create policy notification_delivery_errors_select_admin on public.notification_delivery_errors
  for select to authenticated
  using (public.is_admin());

create or replace function public._log_notification_error(
  p_source text, p_sqlstate text, p_message text, p_context jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  raise warning 'notification failure [%] (%): %', p_source, p_sqlstate, p_message;
  begin
    insert into public.notification_delivery_errors (source, sqlstate, message, context)
    values (p_source, p_sqlstate, left(p_message, 1000), p_context);
  exception when others then
    raise warning 'notification failure log could not be written: %', sqlerrm;
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. ¿Es un evento de dominio real y actual?
-- ---------------------------------------------------------------------------
create or replace function public._notifications_enabled(p_event_at timestamptz)
returns boolean
language sql
stable
set search_path = public
as $$
  select auth.uid() is not null
     and coalesce(current_setting('motods.suppress_notifications', true), '') <> 'on'
     and (p_event_at is null or p_event_at >= now() - interval '10 minutes');
$$;

-- ---------------------------------------------------------------------------
-- 4. Helpers con partición
-- ---------------------------------------------------------------------------
create or replace function public._notify(
  p_recipient uuid, p_type text, p_title text, p_message text,
  p_entity_type text, p_entity_id uuid, p_sale_id uuid, p_url text,
  p_actor uuid, p_event_key text, p_metadata jsonb default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_recipient is null then return; end if;
  if p_actor is not null and p_actor = p_recipient then return; end if;
  -- Un actor sandbox (pruebas) nunca notifica a un usuario real.
  if p_actor is not null
     and exists (select 1 from public.profiles where id = p_actor and is_sandbox)
     and not exists (select 1 from public.profiles where id = p_recipient and is_sandbox) then
    return;
  end if;
  insert into public.notifications (
    recipient_user_id, type, title, message, entity_type, entity_id, sale_id,
    destination_url, actor_id, event_key, metadata)
  values (
    p_recipient, p_type, p_title, left(p_message, 500), p_entity_type, p_entity_id, p_sale_id,
    p_url, p_actor, p_event_key, p_metadata)
  on conflict (recipient_user_id, event_key) where event_key is not null do nothing;
end;
$$;

-- Todos los admins ACTIVOS de la misma partición que `p_subject` (el
-- vendedor cuya actividad se notifica), menos el actor.
drop function if exists public._notify_admins(text, text, text, text, uuid, uuid, text, uuid, text, jsonb);
create or replace function public._notify_admins(
  p_subject uuid,
  p_type text, p_title text, p_message text,
  p_entity_type text, p_entity_id uuid, p_sale_id uuid, p_url text,
  p_actor uuid, p_event_key text, p_metadata jsonb default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sandbox boolean := coalesce((select is_sandbox from public.profiles where id = p_subject), false);
  v_admin record;
begin
  for v_admin in
    select id from public.profiles
    where role = 'admin' and account_status = 'ACTIVE' and is_sandbox = v_sandbox
  loop
    perform public._notify(v_admin.id, p_type, p_title, p_message, p_entity_type, p_entity_id,
      p_sale_id, p_url, p_actor, p_event_key, p_metadata);
  end loop;
end;
$$;

revoke all on function public._notify(uuid, text, text, text, text, uuid, uuid, text, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public._notify_admins(uuid, text, text, text, text, uuid, uuid, text, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public._log_notification_error(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public._notifications_enabled(timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Triggers de dominio (mismas reglas y textos; + guardia, partición y
--    registro de fallos).
-- ---------------------------------------------------------------------------
create or replace function public.notifications_on_sale_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  v_seller_url text := '/seller/ventas/' || new.sale_id::text;
  v_admin_url  text := '/admin/ventas/' || new.sale_id::text;
  v_meta jsonb;
begin
  if not public._notifications_enabled(new.created_at) then
    return null;
  end if;
  begin
    select * into c from public._notification_sale_context(new.sale_id);
    if c.seller_id is null then
      return null;
    end if;
    v_meta := jsonb_build_object('saleNumber', c.sale_number);

    if new.from_status = 'DRAFT' and new.to_status = 'PENDING' then
      perform public._notify_admins(c.seller_id, 'SALE_SUBMITTED', 'Nueva venta',
        c.seller_name || ' envió ' || c.sale_phrase || '.',
        'sale', new.sale_id, new.sale_id, v_admin_url, new.changed_by,
        'sale:' || new.sale_id || ':submitted:' || new.id, v_meta);

    elsif new.from_status = 'PENDING' and new.to_status = 'SOLD' then
      if new.changed_by is not distinct from c.seller_id then
        perform public._notify_admins(c.seller_id, 'SALE_MARKED_SOLD', 'Venta confirmada',
          c.seller_name || ' marcó ' || c.sale_phrase || ' como vendida.',
          'sale', new.sale_id, new.sale_id, v_admin_url, new.changed_by,
          'sale:' || new.sale_id || ':sold:' || new.id, v_meta);
      else
        perform public._notify(c.seller_id, 'SALE_MARKED_SOLD', 'Venta confirmada',
          'Administración confirmó ' || c.sale_phrase || '.',
          'sale', new.sale_id, new.sale_id, v_seller_url, new.changed_by,
          'sale:' || new.sale_id || ':sold:' || new.id, v_meta);
      end if;

    elsif new.from_status = 'SOLD' and new.to_status = 'PAID' then
      -- Una sola notificación (sin otra de "comisión elegible"). El texto
      -- describe el motor vigente (20260921120000): la comisión pasa a
      -- ELIGIBLE al cobrarse (eligible_at = paid_at) y la liquidación semanal
      -- la reclama por la semana de CONFIRMACIÓN (sales.sold_at).
      perform public._notify(c.seller_id, 'SALE_MARKED_PAID', 'Venta pagada',
        upper(left(c.sale_phrase, 1)) || substr(c.sale_phrase, 2)
          || ' fue marcada como pagada. Tu comisión ya es elegible y se liquida en la semana en que se confirmó la venta.',
        'sale', new.sale_id, new.sale_id, v_seller_url, new.changed_by,
        'sale:' || new.sale_id || ':paid:' || new.id, v_meta);

    elsif new.from_status = 'PENDING' and new.to_status = 'DRAFT' then
      perform public._notify(c.seller_id, 'SALE_RETURNED_TO_DRAFT', 'Venta devuelta',
        'Administración devolvió ' || c.sale_phrase || ' a borrador.'
          || coalesce(' Motivo: ' || left(nullif(btrim(new.reason), ''), 160), ''),
        'sale', new.sale_id, new.sale_id, v_seller_url, new.changed_by,
        'sale:' || new.sale_id || ':returned:' || new.id, v_meta);
    end if;
  exception when others then
    perform public._log_notification_error('notifications_on_sale_status', sqlstate, sqlerrm,
      jsonb_build_object('historyId', new.id, 'saleId', new.sale_id, 'from', new.from_status, 'to', new.to_status));
  end;
  return null;
end;
$$;

create or replace function public.notifications_on_contract_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contract record;
  c record;
  v_type text;
  v_title text;
  v_message text;
  v_step text;
begin
  if not public._notifications_enabled(new.created_at) then
    return null;
  end if;
  begin
    if new.to_status is not distinct from new.from_status then
      return null;
    end if;
    select sale_id, provider_name_snapshot into v_contract
      from public.sale_financing_contracts where id = new.contract_id;
    if v_contract.sale_id is null then
      return null;
    end if;
    select * into c from public._notification_sale_context(v_contract.sale_id);
    if c.seller_id is null then
      return null;
    end if;

    if new.to_status = 'SENT' then
      v_type := 'CONTRACT_SENT'; v_title := 'Contrato enviado'; v_step := 'sent';
      v_message := 'Administración envió el contrato de ' || v_contract.provider_name_snapshot
        || ' para ' || c.sale_phrase || '.';
    elsif new.to_status = 'SIGNED' then
      v_type := 'CONTRACT_SIGNED'; v_title := 'Contrato firmado'; v_step := 'signed';
      v_message := 'El contrato de ' || v_contract.provider_name_snapshot || ' de '
        || c.sale_phrase || ' fue marcado como firmado.';
    elsif new.to_status = 'ACCREDITED' then
      v_type := 'CONTRACT_ACCREDITED'; v_title := 'Financiamiento acreditado'; v_step := 'accredited';
      v_message := v_contract.provider_name_snapshot || ' acreditó el financiamiento de '
        || c.sale_phrase || '.';
    else
      return null;
    end if;

    perform public._notify(c.seller_id, v_type, v_title, v_message,
      'financing_contract', new.contract_id, v_contract.sale_id,
      '/seller/ventas/' || v_contract.sale_id::text, new.changed_by,
      'contract:' || new.contract_id || ':' || v_step || ':' || new.id,
      jsonb_build_object('saleNumber', c.sale_number, 'provider', v_contract.provider_name_snapshot));
  exception when others then
    perform public._log_notification_error('notifications_on_contract_event', sqlstate, sqlerrm,
      jsonb_build_object('eventId', new.id, 'contractId', new.contract_id, 'to', new.to_status));
  end;
  return null;
end;
$$;

create or replace function public.notifications_on_edit_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  v_meta jsonb;
begin
  if not public._notifications_enabled(
       case when tg_op = 'INSERT' then new.created_at else coalesce(new.reviewed_at, now()) end) then
    return null;
  end if;
  begin
    select * into c from public._notification_sale_context(new.sale_id);
    v_meta := jsonb_build_object('saleNumber', c.sale_number);

    if tg_op = 'INSERT' then
      if new.status = 'PENDING' then
        perform public._notify_admins(new.requested_by, 'SALE_EDIT_REQUESTED', 'Edición pendiente',
          public._notification_person(new.requested_by) || ' solicitó modificar ' || c.sale_phrase || '.',
          'sale_edit_request', new.id, new.sale_id,
          '/admin/aprobaciones/ediciones/' || new.id::text, new.requested_by,
          'edit-request:' || new.id || ':requested', v_meta);
      end if;
    elsif old.status = 'PENDING' and new.status = 'APPROVED' then
      perform public._notify(new.requested_by, 'SALE_EDIT_APPROVED', 'Edición aprobada',
        'Administración aprobó los cambios solicitados para ' || c.sale_phrase || '.',
        'sale_edit_request', new.id, new.sale_id,
        '/seller/ventas/' || new.sale_id::text, new.reviewed_by,
        'edit-request:' || new.id || ':approved', v_meta);
    elsif old.status = 'PENDING' and new.status = 'REJECTED' then
      -- La nota de revisión ya es visible para el vendedor en su ficha.
      perform public._notify(new.requested_by, 'SALE_EDIT_REJECTED', 'Edición rechazada',
        'Administración rechazó la solicitud de cambios de ' || c.sale_phrase || '.'
          || coalesce(' Motivo: ' || left(nullif(btrim(new.review_note), ''), 160), ''),
        'sale_edit_request', new.id, new.sale_id,
        '/seller/ventas/' || new.sale_id::text, new.reviewed_by,
        'edit-request:' || new.id || ':rejected', v_meta);
    end if;
  exception when others then
    perform public._log_notification_error('notifications_on_edit_request', sqlstate, sqlerrm,
      jsonb_build_object('requestId', new.id, 'op', tg_op, 'status', new.status));
  end;
  return null;
end;
$$;

create or replace function public.notifications_on_liquidation_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  l record;
  v_range text;
  v_meta jsonb;
begin
  if new.event_type not in ('APPROVED', 'PAID') or not public._notifications_enabled(new.created_at) then
    return null;
  end if;
  begin
    select * into l from public.weekly_liquidations where id = new.liquidation_id;
    if l.id is null then
      return null;
    end if;
    v_range := to_char(l.week_start_date, 'MM/DD') || ' al ' || to_char(l.week_end_date, 'MM/DD');
    v_meta := jsonb_build_object('weekStart', l.week_start_date, 'weekEnd', l.week_end_date,
      'totalCents', l.total_to_pay_cents);

    if new.event_type = 'APPROVED' then
      perform public._notify(l.seller_id, 'LIQUIDATION_APPROVED', 'Liquidación aprobada',
        'Tu liquidación semanal del ' || v_range || ' fue aprobada por '
          || public._notification_money(l.total_to_pay_cents) || '.',
        'weekly_liquidation', l.id, null, '/seller/liquidaciones/' || l.id::text, new.actor_id,
        'liquidation:' || l.id || ':approved:' || new.id, v_meta);
    else
      perform public._notify(l.seller_id, 'LIQUIDATION_PAID', 'Liquidación pagada',
        'Tu liquidación semanal por ' || public._notification_money(l.total_to_pay_cents)
          || ' (' || v_range || ') fue marcada como pagada.',
        'weekly_liquidation', l.id, null, '/seller/liquidaciones/' || l.id::text, new.actor_id,
        'liquidation:' || l.id || ':paid:' || new.id, v_meta);
    end if;
  exception when others then
    perform public._log_notification_error('notifications_on_liquidation_event', sqlstate, sqlerrm,
      jsonb_build_object('eventId', new.id, 'liquidationId', new.liquidation_id, 'type', new.event_type));
  end;
  return null;
end;
$$;

create or replace function public.notifications_on_admin_sale_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
begin
  if new.edit_kind is null or new.edit_kind not in ('ADMIN_EDIT', 'ADMIN_CORRECTION')
     or new.field_path like 'internal_notes%'
     or not public._notifications_enabled(new.changed_at) then
    return null;
  end if;
  begin
    select * into c from public._notification_sale_context(new.sale_id);
    perform public._notify(c.seller_id, 'ADMIN_SALE_CORRECTED', 'Venta actualizada',
      'Administración actualizó ' || c.sale_phrase || '.',
      'sale', new.sale_id, new.sale_id, '/seller/ventas/' || new.sale_id::text, new.changed_by,
      'sale:' || new.sale_id || ':admin-edit:' || new.edit_group,
      jsonb_build_object('saleNumber', c.sale_number));
  exception when others then
    perform public._log_notification_error('notifications_on_admin_sale_change', sqlstate, sqlerrm,
      jsonb_build_object('changeId', new.id, 'saleId', new.sale_id, 'editGroup', new.edit_group));
  end;
  return null;
end;
$$;

create or replace function public.notifications_on_seller_activated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (old.status = 'PENDING' and new.status = 'ACCEPTED' and new.invited_user_id is not null)
     or not public._notifications_enabled(coalesce(new.accepted_at, now())) then
    return null;
  end if;
  begin
    perform public._notify_admins(new.invited_user_id, 'SELLER_ACTIVATED', 'Vendedor activado',
      public._notification_person(new.invited_user_id) || ' activó su cuenta y ya puede registrar ventas.',
      'seller', new.invited_user_id, null, '/admin/vendedores/' || new.invited_user_id::text,
      new.invited_user_id, 'seller:' || new.invited_user_id || ':activated:' || new.id, null);
  exception when others then
    perform public._log_notification_error('notifications_on_seller_activated', sqlstate, sqlerrm,
      jsonb_build_object('invitationId', new.id, 'sellerId', new.invited_user_id));
  end;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Invitación: la cuenta invitada hereda la partición de quien invita
--    (misma función de 20260922120000 + la herencia).
-- ---------------------------------------------------------------------------
create or replace function public.admin_record_seller_invitation(
  p_seller_id uuid, p_email text, p_link_digest text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_invitation_id uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;
  if not exists (select 1 from public.profiles where id = p_seller_id) then
    return jsonb_build_object('ok', false, 'code', 'SELLER_NOT_FOUND');
  end if;

  -- Herencia sandbox: una cuenta invitada por un admin de pruebas es de
  -- pruebas (sus eventos nunca llegan a usuarios reales). Una invitación de
  -- un admin real deja la cuenta como real.
  perform set_config('motods.allow_sandbox_change', 'on', true);
  update public.profiles set
    invited_by = v_uid,
    invited_at = now(),
    is_sandbox = (select p.is_sandbox from public.profiles p where p.id = v_uid)
  where id = p_seller_id;
  perform set_config('motods.allow_sandbox_change', 'off', true);

  select id into v_invitation_id from public.seller_invitations
    where invited_user_id = p_seller_id and status = 'PENDING'
    order by created_at desc limit 1
    for update;

  if found then
    update public.seller_invitations set
      email = btrim(lower(p_email)),
      invited_by = v_uid,
      invited_at = now(),
      link_digest = p_link_digest,
      email_delivery_status = case when p_link_digest is null then null else 'PENDING' end,
      email_last_error = null,
      email_last_attempt_at = null
    where id = v_invitation_id;
  else
    insert into public.seller_invitations (
      email, invited_user_id, invited_by, status, invited_at, link_digest, email_delivery_status)
    values (
      btrim(lower(p_email)), p_seller_id, v_uid, 'PENDING', now(), p_link_digest,
      case when p_link_digest is null then null else 'PENDING' end)
    returning id into v_invitation_id;
  end if;

  insert into public.seller_account_events (seller_id, event_type, actor_id)
  values (p_seller_id, 'SELLER_INVITED', v_uid);

  return jsonb_build_object('ok', true, 'invitationId', v_invitation_id, 'sellerId', p_seller_id);
end;
$$;
revoke all on function public.admin_record_seller_invitation(uuid, text, text) from public, anon;
grant execute on function public.admin_record_seller_invitation(uuid, text, text) to authenticated;
