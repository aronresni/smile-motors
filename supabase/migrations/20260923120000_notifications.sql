-- ===========================================================================
-- NOTIFICACIONES por usuario (persistentes + Realtime).
--
-- Tres conceptos DISTINTOS (no se mezclan):
--   · Actividad      = auditoría histórica del concesionario (admin).
--   · Alertas        = condiciones operativas vigentes (admin).
--   · Notificaciones = mensajes dirigidos a UN usuario (esta migración).
--
-- Una notificación pertenece a UN usuario: si hay varios admins, se crea una
-- por admin (que uno la lea no la marca leída para otro).
--
-- Origen: SOLO operaciones de dominio confiables. Cada transición de negocio
-- ya escribe una fila de historial dentro de la misma transacción de su RPC
-- (sale_status_history, financing_contract_events, sale_edit_requests,
-- weekly_liquidation_events, sale_change_history, seller_invitations); aquí
-- se crean triggers AFTER sobre esas filas. Si la mutación falla o se revierte,
-- la notificación no existe. No se toca ninguna RPC de negocio ni ningún
-- estado. Un error al notificar nunca bloquea la operación de negocio (se
-- registra como WARNING y la operación sigue).
--
-- Deduplicación: `event_key` (derivado del id de la fila de evento) es único
-- POR DESTINATARIO — un mismo evento llega a varios admins.
-- ===========================================================================

create table public.notifications (
  id                uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references public.profiles (id) on delete cascade,
  type              text not null check (type in (
                      'SALE_SUBMITTED', 'SALE_MARKED_SOLD', 'SALE_MARKED_PAID',
                      'SALE_RETURNED_TO_DRAFT',
                      'CONTRACT_SENT', 'CONTRACT_SIGNED', 'CONTRACT_ACCREDITED',
                      'SALE_EDIT_REQUESTED', 'SALE_EDIT_APPROVED', 'SALE_EDIT_REJECTED',
                      'LIQUIDATION_APPROVED', 'LIQUIDATION_PAID',
                      'SELLER_ACTIVATED', 'ADMIN_SALE_CORRECTED'
                    )),
  title             text not null,
  message           text not null,
  entity_type       text,
  entity_id         uuid,
  sale_id           uuid references public.sales (id) on delete cascade,
  -- Solo rutas internas de la app (nunca una URL externa: sin redirecciones abiertas).
  destination_url   text check (destination_url is null or destination_url ~ '^/(admin|seller)(/[A-Za-z0-9/_-]*)?$'),
  actor_id          uuid references public.profiles (id) on delete set null,
  event_key         text,
  metadata          jsonb,
  read_at           timestamptz,
  created_at        timestamptz not null default now()
);

comment on table public.notifications is
  'Notificaciones personales (una fila por destinatario). Las crean SOLO triggers de dominio (SECURITY DEFINER); el usuario solo puede leer las suyas y marcarlas leídas vía RPC.';
comment on column public.notifications.event_key is
  'Clave del evento de negocio (p. ej. sale:<id>:submitted:<historyId>). Única por destinatario: evita duplicados ante reintentos.';

-- Listado paginado y conteo de no leídas por usuario.
create index notifications_recipient_created_idx
  on public.notifications (recipient_user_id, created_at desc, id desc);
create index notifications_recipient_unread_idx
  on public.notifications (recipient_user_id, created_at desc)
  where read_at is null;
create unique index notifications_recipient_event_key_uidx
  on public.notifications (recipient_user_id, event_key)
  where event_key is not null;
create index notifications_sale_idx
  on public.notifications (sale_id) where sale_id is not null;
create index notifications_entity_idx
  on public.notifications (entity_type, entity_id) where entity_id is not null;

-- ---------------------------------------------------------------------------
-- RLS: cada usuario LEE solo las suyas. Nadie las crea, cambia ni borra desde
-- el cliente (marcar leída = RPC más abajo).
-- ---------------------------------------------------------------------------
alter table public.notifications enable row level security;
revoke all on public.notifications from public, anon, authenticated;
grant select on public.notifications to authenticated;

create policy notifications_select_own on public.notifications
  for select to authenticated
  using (recipient_user_id = auth.uid());

-- Realtime (Postgres Changes): el canal filtra por recipient_user_id, pero la
-- frontera de seguridad sigue siendo RLS (Realtime la aplica por suscriptor).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
     ) then
    execute 'alter publication supabase_realtime add table public.notifications';
  end if;
end;
$$;

-- ===========================================================================
-- Helpers internos (NO expuestos a clientes).
-- ===========================================================================

-- Inserta una notificación. Nunca notifica al propio actor. Idempotente por
-- (destinatario, event_key).
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
  insert into public.notifications (
    recipient_user_id, type, title, message, entity_type, entity_id, sale_id,
    destination_url, actor_id, event_key, metadata)
  values (
    p_recipient, p_type, p_title, left(p_message, 500), p_entity_type, p_entity_id, p_sale_id,
    p_url, p_actor, p_event_key, p_metadata)
  on conflict (recipient_user_id, event_key) where event_key is not null do nothing;
end;
$$;

-- Una notificación por cada admin ACTIVO (menos el actor).
create or replace function public._notify_admins(
  p_type text, p_title text, p_message text,
  p_entity_type text, p_entity_id uuid, p_sale_id uuid, p_url text,
  p_actor uuid, p_event_key text, p_metadata jsonb default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin record;
begin
  for v_admin in
    select id from public.profiles where role = 'admin' and account_status = 'ACTIVE'
  loop
    perform public._notify(v_admin.id, p_type, p_title, p_message, p_entity_type, p_entity_id,
      p_sale_id, p_url, p_actor, p_event_key, p_metadata);
  end loop;
end;
$$;

-- Contexto legible de una venta. `sale_phrase` = "la venta VTA-…" o, antes de
-- tener número (se asigna al confirmarla), "la venta de <comprador>".
create or replace function public._notification_sale_context(
  p_sale_id uuid,
  out sale_number text, out seller_id uuid, out seller_name text, out sale_phrase text)
language sql
stable
security definer
set search_path = public
as $$
  select s.sale_number,
         s.seller_id,
         coalesce(nullif(btrim(pr.full_name), ''), pr.email, 'Un vendedor'),
         'la venta ' || coalesce(
           s.sale_number,
           'de ' || nullif(btrim(concat_ws(' ', b.first_name, b.last_name)), ''),
           'nueva')
  from public.sales s
  left join public.profiles pr on pr.id = s.seller_id
  left join public.sale_parties b on b.sale_id = s.id and b.party_role = 'PRIMARY_BUYER'
  where s.id = p_sale_id;
$$;

create or replace function public._notification_money(p_cents bigint)
returns text
language sql
immutable
as $$
  select '$' || to_char(coalesce(p_cents, 0) / 100.0, 'FM999,999,990.00');
$$;

create or replace function public._notification_person(p_profile_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(nullif(btrim(full_name), ''), email, 'Un vendedor')
  from public.profiles where id = p_profile_id;
$$;

revoke all on function public._notify(uuid, text, text, text, text, uuid, uuid, text, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public._notify_admins(text, text, text, text, uuid, uuid, text, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public._notification_sale_context(uuid) from public, anon, authenticated;
revoke all on function public._notification_person(uuid) from public, anon, authenticated;

-- ===========================================================================
-- Triggers de dominio.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Ventas: transiciones de estado (sale_status_history).
--   DRAFT→PENDING   vendedor envió            → admins      SALE_SUBMITTED
--   PENDING→SOLD    la marcó el vendedor      → admins      SALE_MARKED_SOLD
--   PENDING→SOLD    la confirmó administración → vendedor   SALE_MARKED_SOLD
--   SOLD→PAID       (admin o automático)      → vendedor    SALE_MARKED_PAID
--   PENDING→DRAFT   devuelta por admin        → vendedor    SALE_RETURNED_TO_DRAFT
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
  begin
    select * into c from public._notification_sale_context(new.sale_id);
    if c.seller_id is null then
      return null;
    end if;
    v_meta := jsonb_build_object('saleNumber', c.sale_number);

    if new.from_status = 'DRAFT' and new.to_status = 'PENDING' then
      perform public._notify_admins('SALE_SUBMITTED', 'Nueva venta',
        c.seller_name || ' envió ' || c.sale_phrase || '.',
        'sale', new.sale_id, new.sale_id, v_admin_url, new.changed_by,
        'sale:' || new.sale_id || ':submitted:' || new.id, v_meta);

    elsif new.from_status = 'PENDING' and new.to_status = 'SOLD' then
      if new.changed_by is not distinct from c.seller_id then
        perform public._notify_admins('SALE_MARKED_SOLD', 'Venta confirmada',
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
      -- Una sola notificación: no se agrega otra de "comisión elegible".
      -- (La comisión se liquida en la semana en que la venta se confirmó.)
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
    raise warning 'notifications_on_sale_status (%): %', sqlstate, sqlerrm;
  end;
  return null;
end;
$$;

create trigger notifications_on_sale_status
  after insert on public.sale_status_history
  for each row execute function public.notifications_on_sale_status();

-- ---------------------------------------------------------------------------
-- Contratos de financiamiento: una notificación por contrato y transición.
-- ---------------------------------------------------------------------------
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
    raise warning 'notifications_on_contract_event (%): %', sqlstate, sqlerrm;
  end;
  return null;
end;
$$;

create trigger notifications_on_contract_event
  after insert on public.financing_contract_events
  for each row execute function public.notifications_on_contract_event();

-- ---------------------------------------------------------------------------
-- Solicitudes de edición: nueva → admins; aprobada / rechazada → vendedor.
-- ---------------------------------------------------------------------------
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
  begin
    select * into c from public._notification_sale_context(new.sale_id);
    v_meta := jsonb_build_object('saleNumber', c.sale_number);

    if tg_op = 'INSERT' then
      if new.status = 'PENDING' then
        perform public._notify_admins('SALE_EDIT_REQUESTED', 'Edición pendiente',
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
    raise warning 'notifications_on_edit_request (%): %', sqlstate, sqlerrm;
  end;
  return null;
end;
$$;

create trigger notifications_on_edit_request_insert
  after insert on public.sale_edit_requests
  for each row execute function public.notifications_on_edit_request();
create trigger notifications_on_edit_request_review
  after update of status on public.sale_edit_requests
  for each row execute function public.notifications_on_edit_request();

-- ---------------------------------------------------------------------------
-- Liquidación semanal: aprobada / pagada → vendedor. (Los eventos se insertan
-- DESPUÉS de fijar los totales, así que el monto es el definitivo.)
-- ---------------------------------------------------------------------------
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
  begin
    if new.event_type not in ('APPROVED', 'PAID') then
      return null;
    end if;
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
    raise warning 'notifications_on_liquidation_event (%): %', sqlstate, sqlerrm;
  end;
  return null;
end;
$$;

create trigger notifications_on_liquidation_event
  after insert on public.weekly_liquidation_events
  for each row execute function public.notifications_on_liquidation_event();

-- ---------------------------------------------------------------------------
-- Corrección administrativa directa (sale_change_history, edit_kind
-- ADMIN_EDIT / ADMIN_CORRECTION): UNA notificación por edición (edit_group),
-- solo si cambió algo significativo (no las notas internas del admin).
-- Los cambios de una solicitud APROBADA ya se notifican como "Edición
-- aprobada".
-- ---------------------------------------------------------------------------
create or replace function public.notifications_on_admin_sale_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
begin
  begin
    if new.edit_kind is null or new.edit_kind not in ('ADMIN_EDIT', 'ADMIN_CORRECTION') then
      return null;
    end if;
    if new.field_path like 'internal_notes%' then
      return null;
    end if;
    select * into c from public._notification_sale_context(new.sale_id);
    perform public._notify(c.seller_id, 'ADMIN_SALE_CORRECTED', 'Venta actualizada',
      'Administración actualizó ' || c.sale_phrase || '.',
      'sale', new.sale_id, new.sale_id, '/seller/ventas/' || new.sale_id::text, new.changed_by,
      'sale:' || new.sale_id || ':admin-edit:' || new.edit_group,
      jsonb_build_object('saleNumber', c.sale_number));
  exception when others then
    raise warning 'notifications_on_admin_sale_change (%): %', sqlstate, sqlerrm;
  end;
  return null;
end;
$$;

create trigger notifications_on_admin_sale_change
  after insert on public.sale_change_history
  for each row execute function public.notifications_on_admin_sale_change();

-- ---------------------------------------------------------------------------
-- Vendedor activó su cuenta (invitación aceptada) → admins.
-- ---------------------------------------------------------------------------
create or replace function public.notifications_on_seller_activated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if old.status = 'PENDING' and new.status = 'ACCEPTED' and new.invited_user_id is not null then
      perform public._notify_admins('SELLER_ACTIVATED', 'Vendedor activado',
        public._notification_person(new.invited_user_id) || ' activó su cuenta y ya puede registrar ventas.',
        'seller', new.invited_user_id, null, '/admin/vendedores/' || new.invited_user_id::text,
        new.invited_user_id, 'seller:' || new.invited_user_id || ':activated:' || new.id, null);
    end if;
  exception when others then
    raise warning 'notifications_on_seller_activated (%): %', sqlstate, sqlerrm;
  end;
  return null;
end;
$$;

create trigger notifications_on_seller_activated
  after update of status on public.seller_invitations
  for each row execute function public.notifications_on_seller_activated();

-- ---------------------------------------------------------------------------
-- Limpieza referencial de notificaciones sin FK directa (la venta ya borra
-- las suyas por FK): liquidación y vendedor eliminados.
-- ---------------------------------------------------------------------------
create or replace function public.notifications_delete_for_entity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.notifications
  where entity_type = tg_argv[0] and entity_id = old.id;
  return null;
end;
$$;

create trigger notifications_cleanup_liquidation
  after delete on public.weekly_liquidations
  for each row execute function public.notifications_delete_for_entity('weekly_liquidation');
create trigger notifications_cleanup_seller
  after delete on public.profiles
  for each row execute function public.notifications_delete_for_entity('seller');

-- ===========================================================================
-- RPC del usuario (solo sobre SUS notificaciones).
-- ===========================================================================

-- Conteo eficiente de no leídas (índice parcial), sin traer filas.
create or replace function public.notification_unread_count()
returns integer
language sql
stable
security invoker
set search_path = public
as $$
  select count(*)::int
  from public.notifications
  where recipient_user_id = auth.uid() and read_at is null;
$$;
revoke all on function public.notification_unread_count() from public, anon;
grant execute on function public.notification_unread_count() to authenticated;

-- Marca UNA como leída (solo si es del usuario autenticado).
create or replace function public.notification_mark_read(p_notification_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_updated int;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  update public.notifications set read_at = now()
  where id = p_notification_id and recipient_user_id = v_uid and read_at is null;
  get diagnostics v_updated = row_count;
  return jsonb_build_object(
    'ok', true,
    'updated', v_updated,
    'unread', (select count(*) from public.notifications where recipient_user_id = v_uid and read_at is null));
end;
$$;
revoke all on function public.notification_mark_read(uuid) from public, anon;
grant execute on function public.notification_mark_read(uuid) to authenticated;

-- Marca TODAS las del usuario autenticado como leídas.
create or replace function public.notification_mark_all_read()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_updated int;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  update public.notifications set read_at = now()
  where recipient_user_id = v_uid and read_at is null;
  get diagnostics v_updated = row_count;
  return jsonb_build_object('ok', true, 'updated', v_updated, 'unread', 0);
end;
$$;
revoke all on function public.notification_mark_all_read() from public, anon;
grant execute on function public.notification_mark_all_read() to authenticated;
