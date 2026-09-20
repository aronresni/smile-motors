-- ===========================================================================
-- Correo de invitación de vendedores (Resend) — canal ADICIONAL.
--
-- La invitación sigue siendo exactamente la de hoy: `generateLink` (Supabase
-- Auth) + enlace propio `/auth/invitacion?token_hash=…`, de un solo uso, que
-- el admin puede copiar o mandar por WhatsApp. Aquí solo se agrega:
--
--  1. Estado de entrega del correo en `seller_invitations` (para la UX del
--     admin). El estado del correo NUNCA cambia el estado de la cuenta: el
--     vendedor sigue INVITED hasta aceptar (`accept_seller_invitation`).
--  2. `link_digest`: SHA-256 del token del enlace VIGENTE. Es un resumen de
--     un solo sentido — no sirve para autenticarse ni para reconstruir el
--     enlace. Permite comprobar en el servidor que un correo (o un reintento)
--     lleva el enlace vigente y nunca uno ya invalidado por un reenvío.
--  3. Bloqueo de envíos duplicados (doble clic / concurrencia).
--  4. Eventos INVITATION_EMAIL_SENT / INVITATION_EMAIL_FAILED en
--     `seller_account_events` (misma auditoría de siempre).
--
-- Todo sigue pasando por RPC SECURITY DEFINER que exigen is_admin(). No se
-- tocan políticas RLS.
-- ===========================================================================

alter table public.seller_invitations
  add column if not exists email_delivery_status text
    check (email_delivery_status in ('PENDING', 'SENT', 'FAILED')),
  add column if not exists email_sent_at timestamptz,
  add column if not exists email_last_error text,
  add column if not exists email_last_attempt_at timestamptz,
  add column if not exists email_attempts integer not null default 0,
  add column if not exists link_digest text;

comment on column public.seller_invitations.email_delivery_status is
  'Entrega del correo de invitación (Resend): PENDING (en curso) / SENT / FAILED. NULL = invitación anterior al correo. NO es el estado de la cuenta.';
comment on column public.seller_invitations.email_last_error is
  'Código corto del último fallo de envío (p. ej. NOT_CONFIGURED, resend:validation_error). Nunca el mensaje crudo del proveedor ni secretos.';
comment on column public.seller_invitations.link_digest is
  'SHA-256 (hex) del token del enlace de invitación VIGENTE. Resumen de un solo sentido: no autentica ni permite reconstruir el enlace.';

-- Nuevos tipos de evento (se conserva la lista existente).
do $$
declare
  v_con text;
begin
  for v_con in
    select c.conname from pg_constraint c
    where c.conrelid = 'public.seller_account_events'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%event_type%'
  loop
    execute format('alter table public.seller_account_events drop constraint %I', v_con);
  end loop;
end;
$$;
alter table public.seller_account_events
  add constraint seller_account_events_event_type_check check (event_type in (
    'SELLER_INVITED', 'INVITATION_RESENT', 'INVITATION_CANCELLED',
    'SELLER_SUSPENDED', 'SELLER_REACTIVATED', 'SELLER_DISABLED',
    'INVITATION_EMAIL_SENT', 'INVITATION_EMAIL_FAILED'
  ));

-- ---------------------------------------------------------------------------
-- Registrar invitación: ahora guarda el resumen del enlace vigente y deja el
-- correo en PENDING. Si ya hay una invitación PENDING de ese vendedor (se
-- volvió a invitar el mismo correo), se ACTUALIZA esa misma fila: nunca dos
-- invitaciones pendientes para la misma cuenta.
-- (Firma nueva con `p_link_digest` opcional: las llamadas existentes con
-- `p_seller_id`/`p_email` siguen funcionando.)
-- ---------------------------------------------------------------------------
drop function if exists public.admin_record_seller_invitation(uuid, text);
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

  update public.profiles set invited_by = v_uid, invited_at = now()
  where id = p_seller_id;

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

-- ---------------------------------------------------------------------------
-- Reenvío: misma fila; el enlace nuevo reemplaza al anterior (su resumen
-- también) y el estado del correo vuelve a empezar.
-- ---------------------------------------------------------------------------
drop function if exists public.admin_touch_seller_invitation(uuid);
create or replace function public.admin_touch_seller_invitation(
  p_seller_id uuid, p_link_digest text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_inv public.seller_invitations;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  select * into v_inv from public.seller_invitations
    where invited_user_id = p_seller_id and status = 'PENDING'
    order by created_at desc limit 1
    for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'INVITATION_NOT_FOUND');
  end if;

  update public.seller_invitations set
    invited_at = now(),
    link_digest = coalesce(p_link_digest, link_digest),
    email_delivery_status = case when p_link_digest is null then email_delivery_status else 'PENDING' end,
    email_last_error = case when p_link_digest is null then email_last_error else null end,
    email_last_attempt_at = case when p_link_digest is null then email_last_attempt_at else null end
  where id = v_inv.id;
  insert into public.seller_account_events (seller_id, event_type, actor_id)
  values (p_seller_id, 'INVITATION_RESENT', v_uid);

  return jsonb_build_object('ok', true, 'invitationId', v_inv.id);
end;
$$;
revoke all on function public.admin_touch_seller_invitation(uuid, text) from public, anon;
grant execute on function public.admin_touch_seller_invitation(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Inicio de un envío de correo: toma el bloqueo del intento y devuelve el
-- DESTINATARIO desde la base (nunca desde el navegador).
--   · solo invitaciones PENDING de cuentas INVITED;
--   · el resumen recibido debe ser el del enlace VIGENTE (nunca se envía un
--     enlace invalidado por un reenvío);
--   · un envío en curso (PENDING < 60 s) o ya entregado hace < 30 s del MISMO
--     enlace bloquea el duplicado; tras un FAILED se puede reintentar ya.
-- ---------------------------------------------------------------------------
create or replace function public.admin_begin_invitation_email(
  p_seller_id uuid, p_link_digest text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_inv public.seller_invitations;
  v_profile public.profiles;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  select * into v_profile from public.profiles where id = p_seller_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'SELLER_NOT_FOUND');
  end if;
  if v_profile.account_status <> 'INVITED' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATUS');
  end if;

  select * into v_inv from public.seller_invitations
    where invited_user_id = p_seller_id and status = 'PENDING'
    order by created_at desc limit 1
    for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'INVITATION_NOT_FOUND');
  end if;
  if v_inv.link_digest is null or p_link_digest is null or v_inv.link_digest <> p_link_digest then
    return jsonb_build_object('ok', false, 'code', 'STALE_LINK');
  end if;
  if v_inv.email_last_attempt_at is not null and (
       (v_inv.email_delivery_status = 'PENDING' and v_inv.email_last_attempt_at > now() - interval '60 seconds')
    or (v_inv.email_delivery_status = 'SENT' and v_inv.email_last_attempt_at > now() - interval '30 seconds')
  ) then
    return jsonb_build_object('ok', false, 'code', 'EMAIL_COOLDOWN',
      'status', v_inv.email_delivery_status);
  end if;

  update public.seller_invitations set
    email_delivery_status = 'PENDING',
    email_last_attempt_at = now(),
    email_attempts = email_attempts + 1,
    email_last_error = null
  where id = v_inv.id;

  return jsonb_build_object(
    'ok', true,
    'email', v_inv.email,
    'fullName', v_profile.full_name,
    'attempt', v_inv.email_attempts + 1);
end;
$$;
revoke all on function public.admin_begin_invitation_email(uuid, text) from public, anon;
grant execute on function public.admin_begin_invitation_email(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Resultado del envío: SENT / FAILED + evento de auditoría. No toca la
-- cuenta (sigue INVITED hasta que el vendedor acepte).
-- ---------------------------------------------------------------------------
create or replace function public.admin_finish_invitation_email(
  p_seller_id uuid, p_link_digest text, p_sent boolean, p_error text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_inv public.seller_invitations;
  v_error text := left(nullif(btrim(coalesce(p_error, '')), ''), 120);
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  select * into v_inv from public.seller_invitations
    where invited_user_id = p_seller_id and status = 'PENDING'
      and link_digest = p_link_digest
    order by created_at desc limit 1
    for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'INVITATION_NOT_FOUND');
  end if;

  if p_sent then
    update public.seller_invitations set
      email_delivery_status = 'SENT', email_sent_at = now(), email_last_error = null
    where id = v_inv.id;
    insert into public.seller_account_events (seller_id, event_type, actor_id)
    values (p_seller_id, 'INVITATION_EMAIL_SENT', v_uid);
  else
    update public.seller_invitations set
      email_delivery_status = 'FAILED', email_last_error = coalesce(v_error, 'UNKNOWN')
    where id = v_inv.id;
    insert into public.seller_account_events (seller_id, event_type, actor_id, reason)
    values (p_seller_id, 'INVITATION_EMAIL_FAILED', v_uid, coalesce(v_error, 'UNKNOWN'));
  end if;

  return jsonb_build_object('ok', true, 'status', case when p_sent then 'SENT' else 'FAILED' end);
end;
$$;
revoke all on function public.admin_finish_invitation_email(uuid, text, boolean, text) from public, anon;
grant execute on function public.admin_finish_invitation_email(uuid, text, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Actividad: la función vigente (20260918120000) tal cual, con las dos
-- etiquetas nuevas de correo de invitación.
-- ---------------------------------------------------------------------------
create or replace function public.admin_activity_feed(
  p_category   text default 'ALL',
  p_actor_id   uuid default null,
  p_seller_id  uuid default null,
  p_start_date date default null,
  p_end_date   date default null,
  p_search     text default null,
  p_limit      int default 50,
  p_offset     int default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_category text := coalesce(nullif(upper(btrim(p_category)), ''), 'ALL');
  v_search   text := nullif(btrim(coalesce(p_search, '')), '');
  v_start_at timestamptz := case when p_start_date is null then null else public._dealer_day_start_at(p_start_date) end;
  v_end_at   timestamptz := case when p_end_date is null then null else public._dealer_day_start_at(p_end_date + 1) end;
  v_limit    int := greatest(1, least(coalesce(p_limit, 50), 100));
  v_offset   int := greatest(0, coalesce(p_offset, 0));
  v_result   jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  with merged as (
    select
      'VENTAS'::text as category, h.event_type as event_type, h.created_at as occurred_at,
      h.actor_id, h.actor_name, h.actor_role,
      'sale'::text as entity_type, h.sale_id as entity_id, h.sale_id, s.seller_id,
      h.title, h.description, h.metadata, ('/admin/ventas/' || h.sale_id::text) as destination_url,
      h.search_text
    from (
      select
        hs.sale_id, 'SALE_' || hs.to_status as event_type, hs.created_at,
        hs.changed_by as actor_id, pr.full_name as actor_name, pr.role as actor_role,
        case hs.to_status
          when 'PENDING'   then 'Solicitó revisión de la venta ' || coalesce(sl.sale_number, 'sin número')
          when 'SOLD'      then 'Marcó la venta ' || coalesce(sl.sale_number, 'sin número') || ' como VENDIDA'
          when 'PAID'      then 'Marcó la venta ' || coalesce(sl.sale_number, 'sin número') || ' como PAGADA'
          when 'DRAFT'     then 'Devolvió la venta ' || coalesce(sl.sale_number, 'sin número') || ' a borrador'
          when 'CANCELLED' then 'Canceló la venta ' || coalesce(sl.sale_number, 'sin número')
          else 'Cambió el estado de la venta ' || coalesce(sl.sale_number, 'sin número')
        end as title,
        hs.reason as description,
        jsonb_build_object('fromStatus', hs.from_status, 'toStatus', hs.to_status) as metadata,
        coalesce(sl.sale_number, '') || ' ' || coalesce(pr2.full_name, '') as search_text
      from public.sale_status_history hs
      join public.sales sl on sl.id = hs.sale_id
      left join public.profiles pr on pr.id = hs.changed_by
      left join public.profiles pr2 on pr2.id = sl.seller_id
      where sl.operation_type = 'CUBA' and hs.from_status is not null
    ) h
    join public.sales s on s.id = h.sale_id

    union all

    select
      'VENTAS', 'EDIT_REQUESTED', r.created_at,
      r.requested_by, pr.full_name, pr.role,
      'sale_edit_request', r.id, r.sale_id, s.seller_id,
      'Solicitó editar la venta ' || coalesce(s.sale_number, 'sin número'),
      r.reason, jsonb_build_object('status', r.status),
      '/admin/aprobaciones/ediciones/' || r.id::text,
      coalesce(s.sale_number, '') || ' ' || coalesce(pr.full_name, '')
    from public.sale_edit_requests r
    join public.sales s on s.id = r.sale_id
    left join public.profiles pr on pr.id = r.requested_by

    union all

    select
      'VENTAS', 'EDIT_' || r.status, r.reviewed_at,
      r.reviewed_by, pr.full_name, pr.role,
      'sale_edit_request', r.id, r.sale_id, s.seller_id,
      case r.status
        when 'APPROVED' then 'Aprobó una modificación de ' || coalesce(s.sale_number, 'sin número')
        when 'REJECTED' then 'Rechazó una modificación de ' || coalesce(s.sale_number, 'sin número')
        else 'Canceló una solicitud de edición de ' || coalesce(s.sale_number, 'sin número')
      end,
      r.review_note, jsonb_build_object('status', r.status),
      '/admin/aprobaciones/ediciones/' || r.id::text,
      coalesce(s.sale_number, '')
    from public.sale_edit_requests r
    join public.sales s on s.id = r.sale_id
    left join public.profiles pr on pr.id = r.reviewed_by
    where r.status <> 'PENDING' and r.reviewed_at is not null

    union all

    -- Edición / corrección administrativa DIRECTA (una fila por guardado =
    -- edit_group de sale_change_history). Las aprobadas por solicitud ya
    -- aparecen arriba como EDIT_APPROVED.
    select
      'VENTAS', g.edit_kind, g.changed_at,
      g.changed_by, pr.full_name, pr.role,
      'sale', g.sale_id, g.sale_id, s.seller_id,
      case when g.edit_kind = 'ADMIN_CORRECTION'
        then 'Aplicó una corrección administrativa a ' || coalesce(s.sale_number, 'sin número')
        else 'Editó la venta ' || coalesce(s.sale_number, 'una venta en borrador') end,
      g.reason, jsonb_build_object('changeCount', g.change_count, 'editGroup', g.edit_group),
      '/admin/ventas/' || g.sale_id::text,
      coalesce(s.sale_number, '') || ' ' || coalesce(pr.full_name, '')
    from (
      select h.edit_group, h.sale_id, min(h.changed_at) as changed_at,
        (array_agg(h.changed_by))[1] as changed_by, (array_agg(h.reason))[1] as reason,
        (array_agg(h.edit_kind))[1] as edit_kind, count(*) as change_count
      from public.sale_change_history h
      where h.edit_kind in ('ADMIN_EDIT', 'ADMIN_CORRECTION')
      group by h.edit_group, h.sale_id
    ) g
    join public.sales s on s.id = g.sale_id
    left join public.profiles pr on pr.id = g.changed_by

    union all

    select
      'CONTRATOS', 'CONTRACT_' || e.to_status, e.created_at,
      e.changed_by, pr.full_name, pr.role,
      'financing_contract', e.contract_id, c.sale_id, s.seller_id,
      case e.to_status
        when 'SENT' then 'Envió el contrato de ' || c.provider_name_snapshot || ' · ' || coalesce(s.sale_number, 'sin número')
        when 'SIGNED' then 'Marcó firmado el contrato de ' || c.provider_name_snapshot || ' · ' || coalesce(s.sale_number, 'sin número')
        when 'ACCREDITED' then 'Acreditó el contrato de ' || c.provider_name_snapshot || ' · ' || coalesce(s.sale_number, 'sin número')
        else 'Actualizó el contrato de ' || c.provider_name_snapshot
      end,
      e.note, jsonb_build_object('fromStatus', e.from_status, 'toStatus', e.to_status, 'providerName', c.provider_name_snapshot),
      '/admin/ventas/' || c.sale_id::text,
      coalesce(s.sale_number, '') || ' ' || c.provider_name_snapshot
    from public.financing_contract_events e
    join public.sale_financing_contracts c on c.id = e.contract_id
    join public.sales s on s.id = c.sale_id
    left join public.profiles pr on pr.id = e.changed_by

    union all

    select
      'COBROS', 'PAYMENT_SETTLED', a.settled_at,
      a.settled_by, pr.full_name, pr.role,
      'sale_payment_allocation', a.id, a.sale_id, s.seller_id,
      'Registró el cobro de ' || a.provider_name_snapshot || ' · ' || coalesce(s.sale_number, 'sin número'),
      null::text, jsonb_build_object('netCents', a.net_amount_cents),
      '/admin/ventas/' || a.sale_id::text,
      coalesce(s.sale_number, '') || ' ' || a.provider_name_snapshot
    from public.sale_payment_allocations a
    join public.sales s on s.id = a.sale_id
    left join public.profiles pr on pr.id = a.settled_by
    where a.settlement_status = 'SETTLED' and a.settled_at is not null

    union all

    select
      'PRODUCTOS', e.event_type, e.created_at,
      e.actor_id, pr.full_name, pr.role,
      'product', e.product_id, null::uuid, null::uuid,
      case e.event_type
        when 'PRODUCT_CREATED' then 'Creó el producto ' || p.name
        when 'PRODUCT_UPDATED' then 'Actualizó el producto ' || p.name
        when 'PRODUCT_ACTIVATED' then 'Activó el producto ' || p.name
        when 'PRODUCT_DEACTIVATED' then 'Desactivó el producto ' || p.name
        when 'PRODUCT_DUPLICATED' then 'Duplicó el producto ' || p.name
        when 'PRICE_CHANGED' then 'Cambió el precio de ' || p.name
        when 'VARIANT_CREATED' then 'Agregó una variante a ' || p.name
        when 'VARIANT_UPDATED' then 'Actualizó una variante de ' || p.name
        when 'VARIANT_ACTIVATED' then 'Activó una variante de ' || p.name
        when 'VARIANT_DEACTIVATED' then 'Desactivó una variante de ' || p.name
        when 'IMAGE_ADDED' then 'Agregó una imagen a ' || p.name
        when 'IMAGE_REMOVED' then 'Quitó una imagen de ' || p.name
        when 'PRIMARY_IMAGE_CHANGED' then 'Cambió la imagen principal de ' || p.name
        when 'COMMISSION_DEFAULTS_UPDATED' then 'Actualizó la comisión por defecto de ' || p.name
        else 'Actualizó ' || p.name
      end,
      null::text, e.changes,
      '/admin/productos/' || e.product_id::text,
      p.name
    from public.product_catalog_events e
    join public.products p on p.id = e.product_id
    left join public.profiles pr on pr.id = e.actor_id

    union all

    select
      'COMISIONES', e.event_type, e.created_at,
      e.actor_id, pr.full_name, pr.role,
      'sale_commission', e.commission_id, e.sale_id, s.seller_id,
      'Recalculó la comisión de ' || coalesce(s.sale_number, 'sin número') || ' por una edición aprobada',
      e.reason, jsonb_build_object('before', e.before, 'after', e.after),
      '/admin/ventas/' || e.sale_id::text,
      coalesce(s.sale_number, '')
    from public.commission_events e
    join public.sales s on s.id = e.sale_id
    left join public.profiles pr on pr.id = e.actor_id
    where e.event_type = 'COMMISSION_ADJUSTED_BY_APPROVED_SALE_EDIT'

    union all

    select
      'LIQUIDACIONES', e.event_type, e.created_at,
      e.actor_id, pr.full_name, pr.role,
      'weekly_liquidation', e.liquidation_id, null::uuid, wl.seller_id,
      case e.event_type
        when 'CREATED' then 'Creó la liquidación de ' || pr2.full_name || ' (semana del ' || wl.week_start_date || ')'
        when 'ITEMS_CLAIMED' then 'Actualizó las comisiones reclamadas de ' || pr2.full_name
        when 'ADJUSTMENT_ADDED' then 'Agregó un ajuste a la liquidación de ' || pr2.full_name
        when 'APPROVED' then 'Aprobó la liquidación de ' || pr2.full_name
        when 'PAID' then 'Marcó como PAGADA la liquidación de ' || pr2.full_name
        else 'Actualizó la liquidación de ' || pr2.full_name
      end,
      null::text, e.detail,
      '/admin/liquidaciones/' || e.liquidation_id::text,
      pr2.full_name || ' ' || wl.week_start_date::text || ' ' || coalesce(wl.payment_reference, '')
    from public.weekly_liquidation_events e
    join public.weekly_liquidations wl on wl.id = e.liquidation_id
    join public.profiles pr2 on pr2.id = wl.seller_id
    left join public.profiles pr on pr.id = e.actor_id

    union all

    select
      'VENDEDORES', e.event_type, e.created_at,
      e.actor_id, pr.full_name, pr.role,
      'seller', e.seller_id, null::uuid, e.seller_id,
      case e.event_type
        when 'SELLER_INVITED' then 'Invitó a ' || pr2.full_name
        when 'INVITATION_RESENT' then 'Reenvió la invitación a ' || pr2.full_name
        when 'INVITATION_CANCELLED' then 'Canceló la invitación a ' || pr2.full_name
        when 'SELLER_SUSPENDED' then 'Suspendió a ' || pr2.full_name
        when 'SELLER_REACTIVATED' then 'Reactivó a ' || pr2.full_name
        when 'SELLER_DISABLED' then 'Deshabilitó a ' || pr2.full_name
        when 'INVITATION_EMAIL_SENT' then 'Envió por correo la invitación a ' || pr2.full_name
        when 'INVITATION_EMAIL_FAILED' then 'No se pudo enviar por correo la invitación a ' || pr2.full_name
        else 'Actualizó la cuenta de ' || pr2.full_name
      end,
      e.reason, null::jsonb,
      '/admin/vendedores/' || e.seller_id::text,
      pr2.full_name
    from public.seller_account_events e
    join public.profiles pr2 on pr2.id = e.seller_id
    left join public.profiles pr on pr.id = e.actor_id

    union all

    -- LOGISTICA (solo acciones reales del admin — ver comentario superior)
    select
      'LOGISTICA', e.event_type, e.occurred_at,
      e.actor_id, pr.full_name, pr.role,
      'sale_unit_logistics', su.id, su.sale_id, s.seller_id,
      case e.event_type
        when 'TRANSITIONED' then 'Marcó ' || coalesce(s.sale_number, 'sin número') || ' / ' || su.product_name_snapshot
          || ' como ' || public._logistics_status_label(e.to_status)
        when 'ON_HOLD' then 'Puso en espera ' || coalesce(s.sale_number, 'sin número') || ' / ' || su.product_name_snapshot
        when 'CORRECTED' then 'Corrigió el estado logístico de ' || coalesce(s.sale_number, 'sin número') || ' / ' || su.product_name_snapshot
          || ' a ' || public._logistics_status_label(e.to_status)
        else 'Actualizó la logística de ' || coalesce(s.sale_number, 'sin número')
      end,
      e.note, jsonb_build_object('fromStatus', e.from_status, 'toStatus', e.to_status),
      '/admin/ventas/' || su.sale_id::text,
      coalesce(s.sale_number, '') || ' ' || su.product_name_snapshot || ' ' || coalesce(su.tracking_code, '')
    from public.sale_unit_logistics_events e
    join public.sale_units su on su.id = e.sale_unit_id
    join public.sales s on s.id = su.sale_id
    left join public.profiles pr on pr.id = e.actor_id
    where e.event_type in ('TRANSITIONED', 'ON_HOLD', 'CORRECTED')
  ),
  filtered as (
    select * from merged m
    where (v_category = 'ALL' or m.category = v_category)
      and (p_actor_id is null or m.actor_id = p_actor_id)
      and (p_seller_id is null or m.seller_id = p_seller_id)
      and (v_start_at is null or m.occurred_at >= v_start_at)
      and (v_end_at is null or m.occurred_at < v_end_at)
      and (v_search is null or m.search_text ilike '%' || v_search || '%')
  ),
  paged as (
    select * from filtered order by occurred_at desc, category, entity_id, event_type limit v_limit offset v_offset
  ),
  total as (
    select count(*) as n from filtered
  )
  select jsonb_build_object(
    'ok', true,
    'total', (select n from total),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'category', p.category, 'eventType', p.event_type, 'occurredAt', p.occurred_at,
        'actorId', p.actor_id, 'actorName', p.actor_name, 'actorRole', p.actor_role,
        'entityType', p.entity_type, 'entityId', p.entity_id, 'saleId', p.sale_id, 'sellerId', p.seller_id,
        'title', p.title, 'description', p.description, 'metadata', p.metadata,
        'destinationUrl', p.destination_url
      ) order by p.occurred_at desc, p.category, p.entity_id, p.event_type)
      from paged p
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;
