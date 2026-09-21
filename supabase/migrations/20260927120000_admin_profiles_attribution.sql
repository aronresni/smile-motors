-- ---------------------------------------------------------------------------
-- PERFILES DE ADMINISTRADOR + ATRIBUCIÓN COMPLETA DE ACCIONES
--
-- Objetivo: que cada acción importante diga QUIÉN la hizo, con nombre y
-- apellido, en vez de un genérico "Administración".
--
-- Lo que ya estaba bien y NO se toca: las ~40 RPC de administración ya
-- derivan el actor de `auth.uid()` DENTRO de la función (SECURITY DEFINER), y
-- ninguna lo acepta por parámetro, así que el navegador no puede suplantar a
-- nadie. Esta migración solo añade la identidad que faltaba y cierra los
-- huecos donde el autor se perdía.
--
-- Decisión de compatibilidad importante: `profiles.full_name` se lee en 355
-- sitios de 34 migraciones (todas las RPC de lectura lo devuelven como
-- `actor_name`). En vez de tocarlas, `full_name` pasa a ser un ESPEJO que un
-- disparador mantiene a partir del nombre visible. Cambiar el perfil actualiza
-- al instante lo que ya muestran todas esas pantallas.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Identidad de la persona
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists first_name   text,
  add column if not exists last_name    text,
  add column if not exists display_name text,
  add column if not exists avatar_url   text;

comment on column public.profiles.display_name is
  'Nombre con el que la persona aparece en la app. Manda sobre first/last. `full_name` se mantiene sincronizado por disparador para todo el código que ya lo lee.';

-- Nombre visible, en una sola regla para toda la base:
--   display_name → first + last → full_name → null.
-- NUNCA cae al correo: el correo de un administrador no debe aparecerle a un
-- vendedor solo porque actuó sobre su venta.
create or replace function public.person_display_name(p_profile_id uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select nullif(btrim(coalesce(
    nullif(btrim(p.display_name), ''),
    nullif(btrim(concat_ws(' ', nullif(btrim(p.first_name), ''), nullif(btrim(p.last_name), ''))), ''),
    nullif(btrim(p.full_name), '')
  )), '')
  from public.profiles p
  where p.id = p_profile_id;
$$;

revoke all on function public.person_display_name(uuid) from public, anon;
grant execute on function public.person_display_name(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. `full_name` como espejo del nombre visible
--
-- Los dos sentidos:
--   · se escribe display_name o first/last → full_name se actualiza (y todas
--     las pantallas que ya leen full_name muestran el nombre nuevo),
--   · llega solo full_name (alta por invitación, script de servicio) →
--     se derivan first/last para que el formulario de perfil salga completo.
-- ---------------------------------------------------------------------------
create or replace function public.profiles_sync_display_name()
returns trigger
language plpgsql
as $$
declare
  v_visible text;
begin
  new.display_name := nullif(btrim(new.display_name), '');
  new.first_name   := nullif(btrim(new.first_name), '');
  new.last_name    := nullif(btrim(new.last_name), '');
  new.full_name    := nullif(btrim(new.full_name), '');

  v_visible := coalesce(
    new.display_name,
    nullif(btrim(concat_ws(' ', new.first_name, new.last_name)), ''));

  if v_visible is not null then
    new.full_name := v_visible;
  elsif new.full_name is not null and new.first_name is null and new.last_name is null then
    -- Solo llegó el nombre completo: se reparte para poder editarlo.
    new.first_name := split_part(new.full_name, ' ', 1);
    new.last_name  := nullif(btrim(substr(new.full_name, length(split_part(new.full_name, ' ', 1)) + 1)), '');
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_sync_display_name on public.profiles;
create trigger profiles_sync_display_name
  before insert or update on public.profiles
  for each row execute function public.profiles_sync_display_name();

-- Reparto inicial de los nombres que ya existen (no inventa ninguno).
update public.profiles
   set first_name = split_part(btrim(full_name), ' ', 1),
       last_name  = nullif(btrim(substr(btrim(full_name), length(split_part(btrim(full_name), ' ', 1)) + 1)), '')
 where nullif(btrim(full_name), '') is not null
   and first_name is null
   and last_name is null;

-- ---------------------------------------------------------------------------
-- 3. Directorio seguro: lo MÍNIMO para poder escribir "Camila Rodríguez"
--
-- Un vendedor no puede leer `profiles` (su RLS es "yo o un admin"), y no se
-- va a abrir. En su lugar, esta vista expone tres campos —id, nombre visible
-- y rol— y solo de los administradores activos y de uno mismo. Ni correo, ni
-- teléfono, ni estado de cuenta, ni nada más.
-- ---------------------------------------------------------------------------
drop view if exists public.people_directory;
create view public.people_directory as
  select
    p.id,
    public.person_display_name(p.id) as display_name,
    p.role
  from public.profiles p
  where (p.role = 'admin' and p.account_status = 'ACTIVE')
     or p.id = auth.uid();

comment on view public.people_directory is
  'Identidad pública mínima para atribuir acciones (id, nombre visible, rol). Solo administradores activos y uno mismo. Nunca correo ni teléfono.';

grant select on public.people_directory to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Notificaciones con nombre y apellido
--
-- Los seis textos que decían "Administración …" se componen en los
-- disparadores de dominio, que ya conocen al actor. En vez de reescribir seis
-- funciones largas (con el riesgo que eso trae), se resuelve en el ÚNICO
-- punto por el que pasan todas: `_notify`. Si el actor tiene nombre, el
-- genérico se reemplaza por su nombre; si no, el texto queda igual.
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
declare
  v_message text := p_message;
  v_actor   text;
begin
  if p_recipient is null then return; end if;
  if p_actor is not null and p_actor = p_recipient then return; end if;
  -- Un actor sandbox (pruebas) nunca notifica a un usuario real.
  if p_actor is not null
     and exists (select 1 from public.profiles where id = p_actor and is_sandbox)
     and not exists (select 1 from public.profiles where id = p_recipient and is_sandbox) then
    return;
  end if;

  -- "Administración confirmó tu venta." → "Camila Rodríguez confirmó tu venta."
  if p_actor is not null then
    v_actor := public.person_display_name(p_actor);
    if v_actor is not null then
      v_message := replace(v_message, 'Administración', v_actor);
    end if;
  end if;

  insert into public.notifications (
    recipient_user_id, type, title, message, entity_type, entity_id, sale_id,
    destination_url, actor_id, event_key, metadata)
  values (
    p_recipient, p_type, p_title, left(v_message, 500), p_entity_type, p_entity_id, p_sale_id,
    p_url, p_actor, p_event_key, p_metadata)
  on conflict (recipient_user_id, event_key) where event_key is not null do nothing;
end;
$$;

revoke all on function public._notify(uuid, text, text, text, text, uuid, uuid, text, uuid, text, jsonb)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Huecos de atribución
-- ---------------------------------------------------------------------------

-- 5.a  Sobre el motor VIEJO de pagos (`sync_sale_payment_allocations`, el que
--      borra y recrea las asignaciones sin actor ni historial): PARECE una
--      puerta abierta porque está concedido a `authenticated`, pero no lo es.
--      Es `security invoker`, así que la RLS de `sale_payment_allocations`
--      —escritura solo sobre el BORRADOR propio— es la que manda: fuera del
--      borrador no puede tocar nada, ni siquiera un admin. Se documenta aquí
--      para que nadie lo "arregle" revocándolo: `save_cuba_sale_draft` lo
--      invoca con los permisos de quien llama y dejaría a los vendedores sin
--      poder guardar. Fuera del borrador, el camino auditado es
--      `set_sale_payment_allocations`.

-- 5.b  Cancelar una solicitud de edición dejaba `reviewed_by` en NULL.
create or replace function public.cancel_sale_edit_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_req public.sale_edit_requests;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  select * into v_req from public.sale_edit_requests where id = p_request_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'REQUEST_NOT_FOUND');
  end if;
  if v_req.requested_by <> v_uid then
    return jsonb_build_object('ok', false, 'code', 'NOT_OWNER');
  end if;
  if v_req.status <> 'PENDING' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATUS');
  end if;
  -- ÚNICO cambio respecto de la versión anterior: queda registrado quién
  -- canceló (antes  se quedaba en NULL).
  update public.sale_edit_requests
     set status = 'CANCELLED', reviewed_at = now(), reviewed_by = v_uid
   where id = p_request_id;
  return jsonb_build_object('ok', true, 'requestId', p_request_id);
end;
$$;

revoke all on function public.cancel_sale_edit_request(uuid) from public, anon;
grant execute on function public.cancel_sale_edit_request(uuid) to authenticated;

-- 5.c  Quién creó el borrador de la liquidación (hasta ahora solo se deducía
--      del evento CREATED).
alter table public.weekly_liquidations
  add column if not exists created_by uuid references public.profiles (id) on delete set null;

update public.weekly_liquidations wl
   set created_by = e.actor_id
  from (
    select distinct on (liquidation_id) liquidation_id, actor_id
      from public.weekly_liquidation_events
     where event_type = 'CREATED' and actor_id is not null
     order by liquidation_id, created_at
  ) e
 where e.liquidation_id = wl.id
   and wl.created_by is null;

-- El evento CREATED fija el autor del borrador de aquí en adelante, sin
-- tocar la RPC de creación (que es larga y no necesita cambiar).
create or replace function public.weekly_liquidations_set_creator()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.event_type = 'CREATED' and new.actor_id is not null then
    update public.weekly_liquidations
       set created_by = new.actor_id
     where id = new.liquidation_id and created_by is null;
  end if;
  return new;
end;
$$;

drop trigger if exists weekly_liquidations_set_creator on public.weekly_liquidation_events;
create trigger weekly_liquidations_set_creator
  after insert on public.weekly_liquidation_events
  for each row execute function public.weekly_liquidations_set_creator();

-- 5.d  Al deshacer un cobro NO se puede perder quién lo había cobrado.
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
  v_before text;
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

  -- Antes de borrar `settled_by`, su identidad queda escrita en el historial.
  v_before := 'SETTLED · ' || coalesce(public.person_display_name(v_alloc.settled_by), 'sin registro de autor');

  update public.sale_payment_allocations
     set settlement_status = 'PENDING', settled_at = null, settled_by = null,
         updated_at = now()
   where id = p_allocation_id;

  perform public.log_sale_field_change(
    gen_random_uuid(), v_alloc.sale_id, v_uid, v_reason,
    'payments.' || p_allocation_id::text || '.settlement',
    'UPDATE', v_before, 'PENDING');

  return jsonb_build_object('ok', true, 'saleId', v_alloc.sale_id);
end;
$$;

revoke all on function public.admin_unsettle_payment_allocation(uuid, text) from public, anon;
grant execute on function public.admin_unsettle_payment_allocation(uuid, text) to authenticated;
