-- ---------------------------------------------------------------------------
-- Notificaciones push (Web Push / VAPID) — CANAL DE ENTREGA, no un sistema
-- nuevo de notificaciones.
--
-- La notificación de la base sigue siendo la autoridad: la crean los triggers
-- de dominio de 20260923120000 / 20260924120000 y nada de aquí cambia ni
-- quién recibe, ni cuándo, ni con qué texto. Esto solo añade:
--   · dónde entregar (una fila por dispositivo del usuario),
--   · qué notificaciones quedan por entregar (`notifications.push_dispatched_at`).
--
-- Un fallo de entrega NUNCA puede afectar a la operación de negocio: el envío
-- ocurre fuera de la transacción (después de la respuesta, ver
-- `src/lib/push/dispatch.ts`), así que ni siquiera puede revertirla.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Dispositivos suscritos
-- ---------------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  -- Identidad de la suscripción: el navegador da un endpoint único por
  -- dispositivo+instalación. Si el mismo dispositivo lo usa otra cuenta, la
  -- fila cambia de dueño (ver `push_subscription_register`).
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  device_label text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  last_used_at timestamptz,
  -- Baja: al desactivarlas, al cerrar sesión o cuando el servicio de push
  -- responde que el endpoint ya no existe (404/410).
  revoked_at   timestamptz
);

comment on table public.push_subscriptions is
  'Dispositivos a los que entregar notificaciones push. Un usuario puede tener varios (iPhone, iPad, escritorio).';

create index if not exists push_subscriptions_user_active_idx
  on public.push_subscriptions (user_id) where revoked_at is null;

-- ---------------------------------------------------------------------------
-- 2. RLS: cada quien ve SOLO sus dispositivos; alta y baja por RPC
-- ---------------------------------------------------------------------------
alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_select_own on public.push_subscriptions;
create policy push_subscriptions_select_own on public.push_subscriptions
  for select to authenticated
  using (user_id = auth.uid());

-- Sin políticas de insert/update/delete a propósito: registrar y dar de baja
-- pasa por las funciones de abajo, que SIEMPRE usan `auth.uid()` como dueño.
-- Así nadie puede registrar un dispositivo a nombre de otro, cambiar las
-- claves del dispositivo de otro ni darlo de baja.

-- ---------------------------------------------------------------------------
-- 3. Alta del dispositivo (el dueño es siempre quien tiene la sesión)
-- ---------------------------------------------------------------------------
create or replace function public.push_subscription_register(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null,
  p_device_label text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;
  -- El endpoint lo emite el servicio de push del navegador; siempre https.
  if p_endpoint is null or p_endpoint !~ '^https://' or length(p_endpoint) < 30 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_ENDPOINT');
  end if;
  if coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_KEYS');
  end if;

  -- Mismo dispositivo, otra cuenta: la suscripción pasa a la sesión actual.
  -- Es lo que evita que las notificaciones del vendedor anterior sigan
  -- llegando al teléfono que ahora usa otro.
  insert into public.push_subscriptions as s
    (user_id, endpoint, p256dh, auth, user_agent, device_label)
  values
    (v_user, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 400), left(p_device_label, 80))
  on conflict (endpoint) do update
    set user_id      = v_user,
        p256dh       = excluded.p256dh,
        auth         = excluded.auth,
        user_agent   = coalesce(excluded.user_agent, s.user_agent),
        device_label = coalesce(excluded.device_label, s.device_label),
        revoked_at   = null,
        updated_at   = now()
  returning s.id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

revoke all on function public.push_subscription_register(text, text, text, text, text)
  from public, anon;
grant execute on function public.push_subscription_register(text, text, text, text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Baja del dispositivo (solo el propio)
-- ---------------------------------------------------------------------------
create or replace function public.push_subscription_revoke(p_endpoint text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_count int;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;

  update public.push_subscriptions
     set revoked_at = now(), updated_at = now()
   where endpoint = p_endpoint
     and user_id = v_user
     and revoked_at is null;
  get diagnostics v_count = row_count;

  return jsonb_build_object('ok', true, 'revoked', v_count);
end;
$$;

revoke all on function public.push_subscription_revoke(text) from public, anon;
grant execute on function public.push_subscription_revoke(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Bandeja de salida sobre la propia notificación
-- ---------------------------------------------------------------------------
alter table public.notifications
  add column if not exists push_dispatched_at timestamptz;

comment on column public.notifications.push_dispatched_at is
  'Momento en que se intentó la entrega push. Null = pendiente. No dice si llegó: la notificación de la base es la autoridad.';

create index if not exists notifications_push_pending_idx
  on public.notifications (created_at)
  where push_dispatched_at is null;

-- ---------------------------------------------------------------------------
-- 6. Reclamo atómico de lo pendiente (SOLO servidor de confianza)
--
-- Devuelve una fila por (notificación × dispositivo del destinatario) y marca
-- la notificación como despachada en el mismo paso, con `skip locked`: dos
-- peticiones simultáneas nunca envían la misma notificación dos veces.
--
-- Reglas:
--   · solo lo reciente (una notificación de hace horas ya no interrumpe),
--   · nada que el usuario ya haya leído en la app,
--   · una notificación sin dispositivos también se marca: no hay a dónde
--     entregar, y no debe quedar pendiente para siempre.
-- ---------------------------------------------------------------------------
create or replace function public.push_claim_pending(p_limit int default 100)
returns table (
  notification_id  uuid,
  recipient_id     uuid,
  title            text,
  message          text,
  destination_url  text,
  unread_count     bigint,
  subscription_id  uuid,
  endpoint         text,
  p256dh           text,
  auth             text)
language sql
security definer
set search_path = public
as $$
  with claimed as (
    update public.notifications n
       set push_dispatched_at = now()
     where n.id in (
       select c.id
         from public.notifications c
        where c.push_dispatched_at is null
          and c.read_at is null
          and c.created_at > now() - interval '30 minutes'
        order by c.created_at
        limit greatest(1, least(coalesce(p_limit, 100), 500))
        for update skip locked)
    returning n.id, n.recipient_user_id, n.title, n.message, n.destination_url
  )
  select
    c.id,
    c.recipient_user_id,
    c.title,
    c.message,
    c.destination_url,
    (select count(*) from public.notifications u
      where u.recipient_user_id = c.recipient_user_id and u.read_at is null),
    s.id,
    s.endpoint,
    s.p256dh,
    s.auth
  from claimed c
  join public.push_subscriptions s
    on s.user_id = c.recipient_user_id
   and s.revoked_at is null;
$$;

revoke all on function public.push_claim_pending(int) from public, anon, authenticated;
grant execute on function public.push_claim_pending(int) to service_role;

-- ---------------------------------------------------------------------------
-- 7. Contador real de no leídas de un usuario (para la insignia del icono).
--    Servidor de confianza: se usa al entregar, cuando no hay sesión de esa
--    persona. La versión con sesión sigue siendo `notification_unread_count`.
-- ---------------------------------------------------------------------------
create or replace function public.push_unread_count(p_user_id uuid)
returns bigint
language sql
security definer
set search_path = public
as $$
  select count(*) from public.notifications
   where recipient_user_id = p_user_id and read_at is null;
$$;

revoke all on function public.push_unread_count(uuid) from public, anon, authenticated;
grant execute on function public.push_unread_count(uuid) to service_role;
