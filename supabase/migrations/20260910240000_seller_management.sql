-- ===========================================================================
-- ADMIN · GESTIÓN DE VENDEDORES — invitación por correo, activación,
-- suspensión/reactivación, deshabilitado. Fase 2 del área de administración.
--
-- Diseño (fuente única de verdad):
--   - `profiles.account_status` (INVITED/ACTIVE/SUSPENDED/DISABLED) es la
--     fuente de verdad del ciclo de vida de la cuenta.
--   - `profiles.is_active` (YA EXISTÍA, ya lo usan `is_admin()`,
--     `user_role()`, `getAuthContext()`, `loginAction`, TODAS las políticas
--     RLS de este proyecto) se mantiene como columna DERIVADA, sincronizada
--     automáticamente por trigger desde `account_status`. Así el bloqueo de
--     acceso de una cuenta SUSPENDIDA/DESHABILITADA/INVITADA-sin-activar
--     funciona en TODO el código ya existente (login, sesión, RLS, RPCs) sin
--     tocar ni una línea de ese código — nunca dos fuentes de verdad
--     compitiendo.
--   - `seller_invitations` — trazabilidad de quién invitó, cuándo, estado.
--     NUNCA guarda tokens de Supabase Auth (Supabase sigue siendo la única
--     autoridad de autenticación).
--   - `seller_account_events` — auditoría enfocada de este módulo (se puede
--     conectar después a un módulo de auditoría global; no existe todavía
--     ninguna tabla de auditoría genérica en el proyecto).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. profiles — columnas nuevas del ciclo de vida de cuenta.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists account_status text not null default 'ACTIVE'
    check (account_status in ('INVITED', 'ACTIVE', 'SUSPENDED', 'DISABLED')),
  add column if not exists phone               text,
  add column if not exists invited_by          uuid references public.profiles (id) on delete set null,
  add column if not exists invited_at          timestamptz,
  add column if not exists suspended_at        timestamptz,
  add column if not exists suspended_by        uuid references public.profiles (id) on delete set null,
  add column if not exists suspension_reason   text,
  add column if not exists reactivated_at      timestamptz,
  add column if not exists reactivated_by      uuid references public.profiles (id) on delete set null;

comment on column public.profiles.account_status is
  'Fuente de verdad del ciclo de vida de la cuenta. `is_active` se deriva de esta columna por trigger — nunca se escribe a mano por separado.';

-- Todo perfil YA existente (creado antes de esta migración) queda ACTIVE
-- (coincide con su `is_active` real de antes: todas las cuentas actuales
-- fueron dadas de alta directamente, nunca por invitación).
update public.profiles set account_status = 'ACTIVE' where account_status is distinct from 'ACTIVE';

-- ---------------------------------------------------------------------------
-- 2. Sincronización is_active <- account_status (una sola dirección).
-- ---------------------------------------------------------------------------
create or replace function public.sync_profile_is_active()
returns trigger
language plpgsql
as $$
begin
  new.is_active := (new.account_status = 'ACTIVE');
  return new;
end;
$$;

drop trigger if exists profiles_sync_is_active on public.profiles;
create trigger profiles_sync_is_active
  before insert or update on public.profiles
  for each row execute function public.sync_profile_is_active();

-- ---------------------------------------------------------------------------
-- 3. protect_profile_privileged_columns — se extiende a las columnas nuevas.
--    (la función YA existía — revierte `role`/`is_active` si quien escribe
--    no es admin; ahora también protege `account_status` y todo el rastro de
--    invitación/suspensión/reactivación, para que un vendedor NUNCA pueda
--    autoactivarse tras una suspensión ni maquillar su propio historial).
-- ---------------------------------------------------------------------------
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
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. handle_new_user — reconoce `account_status`/`phone` en los metadatos
--    del alta (usados por la invitación); si no vienen, ACTIVE como siempre
--    (nunca cambia el comportamiento de una alta directa/semilla existente).
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role, account_status, phone)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    case
      when coalesce(new.raw_user_meta_data ->> 'role', '') in ('admin', 'seller')
        then new.raw_user_meta_data ->> 'role'
      else 'seller'
    end,
    case
      when coalesce(new.raw_user_meta_data ->> 'account_status', '') in ('INVITED', 'ACTIVE', 'SUSPENDED', 'DISABLED')
        then new.raw_user_meta_data ->> 'account_status'
      else 'ACTIVE'
    end,
    nullif(new.raw_user_meta_data ->> 'phone', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. seller_invitations — trazabilidad de invitaciones.
-- ---------------------------------------------------------------------------
create table public.seller_invitations (
  id               uuid primary key default gen_random_uuid(),
  email            text not null,
  invited_user_id  uuid references public.profiles (id) on delete set null,
  invited_by       uuid not null references public.profiles (id) on delete restrict,
  status           text not null default 'PENDING'
    check (status in ('PENDING', 'ACCEPTED', 'EXPIRED', 'CANCELLED')),
  invited_at       timestamptz not null default now(),
  accepted_at      timestamptz,
  cancelled_at     timestamptz,
  created_at       timestamptz not null default now()
);
create index seller_invitations_invited_user_idx on public.seller_invitations (invited_user_id);
create index seller_invitations_email_idx on public.seller_invitations (lower(email));
create index seller_invitations_status_idx on public.seller_invitations (status);

comment on table public.seller_invitations is
  'Trazabilidad de invitaciones por correo — quién invitó, cuándo, estado. NUNCA guarda tokens de Supabase Auth: Supabase sigue siendo la única autoridad de autenticación.';

alter table public.seller_invitations enable row level security;
grant select on public.seller_invitations to authenticated;

create policy seller_invitations_select_admin on public.seller_invitations
  for select to authenticated
  using (public.is_admin());
-- Sin políticas de insert/update/delete para el cliente: toda escritura pasa
-- por las RPC de abajo (SECURITY DEFINER, vuelven a exigir is_admin()).

-- ---------------------------------------------------------------------------
-- 6. seller_account_events — auditoría enfocada de este módulo.
-- ---------------------------------------------------------------------------
create table public.seller_account_events (
  id          uuid primary key default gen_random_uuid(),
  seller_id   uuid not null references public.profiles (id) on delete cascade,
  event_type  text not null check (event_type in (
                'SELLER_INVITED', 'INVITATION_RESENT', 'INVITATION_CANCELLED',
                'SELLER_SUSPENDED', 'SELLER_REACTIVATED', 'SELLER_DISABLED'
              )),
  actor_id    uuid references public.profiles (id) on delete set null,
  reason      text,
  created_at  timestamptz not null default now()
);
create index seller_account_events_seller_idx on public.seller_account_events (seller_id, created_at desc);

alter table public.seller_account_events enable row level security;
grant select on public.seller_account_events to authenticated;

create policy seller_account_events_select_admin on public.seller_account_events
  for select to authenticated
  using (public.is_admin());

-- ===========================================================================
-- 7. RPCs — todas ADMIN-only, todas auditadas. El ENVÍO real del correo de
--    invitación (Supabase Auth Admin API, requiere `service_role`) ocurre en
--    la Server Action; estas RPC son el registro/transición de estado, con
--    la autorización real de RLS/`is_admin()` (nunca solo un botón
--    deshabilitado en el navegador).
-- ===========================================================================

-- Registra una invitación recién enviada (el usuario de Auth + perfil YA
-- existen — los crea `handle_new_user` cuando la Server Action llama a
-- `inviteUserByEmail`). Idempotente por diseño de la Server Action: si ya
-- hay una invitación PENDING para ese vendedor, este RPC no se usa —se usa
-- `admin_resend_seller_invitation` para no duplicar filas.
create or replace function public.admin_record_seller_invitation(
  p_seller_id uuid, p_email text)
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

  insert into public.seller_invitations (email, invited_user_id, invited_by, status, invited_at)
  values (btrim(lower(p_email)), p_seller_id, v_uid, 'PENDING', now())
  returning id into v_invitation_id;

  insert into public.seller_account_events (seller_id, event_type, actor_id)
  values (p_seller_id, 'SELLER_INVITED', v_uid);

  return jsonb_build_object('ok', true, 'invitationId', v_invitation_id, 'sellerId', p_seller_id);
end;
$$;
revoke all on function public.admin_record_seller_invitation(uuid, text) from public, anon;
grant execute on function public.admin_record_seller_invitation(uuid, text) to authenticated;

-- Reenvío: actualiza la MISMA fila de invitación (nunca crea una nueva).
create or replace function public.admin_touch_seller_invitation(p_seller_id uuid)
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

  update public.seller_invitations set invited_at = now() where id = v_inv.id;
  insert into public.seller_account_events (seller_id, event_type, actor_id)
  values (p_seller_id, 'INVITATION_RESENT', v_uid);

  return jsonb_build_object('ok', true, 'invitationId', v_inv.id);
end;
$$;
revoke all on function public.admin_touch_seller_invitation(uuid) from public, anon;
grant execute on function public.admin_touch_seller_invitation(uuid) to authenticated;

-- Cancela la invitación pendiente; la cuenta (nunca activada) pasa a
-- DISABLED — nunca se borra el perfil/usuario de Auth.
create or replace function public.admin_cancel_seller_invitation(p_seller_id uuid)
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

  select * into v_profile from public.profiles where id = p_seller_id for update;
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

  update public.seller_invitations set status = 'CANCELLED', cancelled_at = now() where id = v_inv.id;
  update public.profiles set account_status = 'DISABLED' where id = p_seller_id;

  insert into public.seller_account_events (seller_id, event_type, actor_id)
  values (p_seller_id, 'INVITATION_CANCELLED', v_uid);

  return jsonb_build_object('ok', true, 'sellerId', p_seller_id);
end;
$$;
revoke all on function public.admin_cancel_seller_invitation(uuid) from public, anon;
grant execute on function public.admin_cancel_seller_invitation(uuid) to authenticated;

-- Aceptación: la llama la Server Action del propio vendedor, justo después
-- de fijar su contraseña — NO requiere is_admin() (el vendedor actúa sobre
-- SU PROPIA cuenta), pero solo permite la transición INVITED -> ACTIVE.
create or replace function public.accept_seller_invitation()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
  v_inv public.seller_invitations;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;

  select * into v_profile from public.profiles where id = v_uid for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'PROFILE_NOT_FOUND');
  end if;
  if v_profile.account_status <> 'INVITED' then
    return jsonb_build_object('ok', true, 'alreadyActive', true, 'status', v_profile.account_status);
  end if;

  -- Bypass puntual y de solo esta transacción (ver `protect_profile_privileged_columns`):
  -- esta es la ÚNICA sentencia que corre bajo él, y solo toca `account_status`.
  perform set_config('motods.bypass_profile_guard', 'on', true);
  update public.profiles set account_status = 'ACTIVE' where id = v_uid;

  select * into v_inv from public.seller_invitations
    where invited_user_id = v_uid and status = 'PENDING'
    order by created_at desc limit 1
    for update;
  if found then
    update public.seller_invitations set status = 'ACCEPTED', accepted_at = now() where id = v_inv.id;
  end if;

  return jsonb_build_object('ok', true, 'status', 'ACTIVE');
end;
$$;
revoke all on function public.accept_seller_invitation() from public, anon;
grant execute on function public.accept_seller_invitation() to authenticated;

create or replace function public.admin_suspend_seller(p_seller_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  select * into v_profile from public.profiles where id = p_seller_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'SELLER_NOT_FOUND');
  end if;
  if v_profile.role <> 'seller' then
    return jsonb_build_object('ok', false, 'code', 'NOT_A_SELLER');
  end if;
  if v_profile.account_status <> 'ACTIVE' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATUS');
  end if;

  update public.profiles set
    account_status = 'SUSPENDED',
    suspended_at = now(), suspended_by = v_uid,
    suspension_reason = nullif(btrim(coalesce(p_reason, '')), '')
  where id = p_seller_id;

  insert into public.seller_account_events (seller_id, event_type, actor_id, reason)
  values (p_seller_id, 'SELLER_SUSPENDED', v_uid, nullif(btrim(coalesce(p_reason, '')), ''));

  return jsonb_build_object('ok', true, 'sellerId', p_seller_id, 'status', 'SUSPENDED');
end;
$$;
revoke all on function public.admin_suspend_seller(uuid, text) from public, anon;
grant execute on function public.admin_suspend_seller(uuid, text) to authenticated;

create or replace function public.admin_reactivate_seller(p_seller_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  select * into v_profile from public.profiles where id = p_seller_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'SELLER_NOT_FOUND');
  end if;
  if v_profile.account_status <> 'SUSPENDED' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATUS');
  end if;

  update public.profiles set
    account_status = 'ACTIVE',
    reactivated_at = now(), reactivated_by = v_uid
  where id = p_seller_id;

  insert into public.seller_account_events (seller_id, event_type, actor_id)
  values (p_seller_id, 'SELLER_REACTIVATED', v_uid);

  return jsonb_build_object('ok', true, 'sellerId', p_seller_id, 'status', 'ACTIVE');
end;
$$;
revoke all on function public.admin_reactivate_seller(uuid) from public, anon;
grant execute on function public.admin_reactivate_seller(uuid) to authenticated;

create or replace function public.admin_disable_seller(p_seller_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  select * into v_profile from public.profiles where id = p_seller_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'SELLER_NOT_FOUND');
  end if;
  if v_profile.role <> 'seller' then
    return jsonb_build_object('ok', false, 'code', 'NOT_A_SELLER');
  end if;
  if v_profile.account_status not in ('ACTIVE', 'SUSPENDED') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STATUS');
  end if;

  update public.profiles set account_status = 'DISABLED' where id = p_seller_id;

  insert into public.seller_account_events (seller_id, event_type, actor_id, reason)
  values (p_seller_id, 'SELLER_DISABLED', v_uid, nullif(btrim(coalesce(p_reason, '')), ''));

  return jsonb_build_object('ok', true, 'sellerId', p_seller_id, 'status', 'DISABLED');
end;
$$;
revoke all on function public.admin_disable_seller(uuid, text) from public, anon;
grant execute on function public.admin_disable_seller(uuid, text) to authenticated;

-- ===========================================================================
-- 8. admin_seller_list — listado paginado/buscable (ADMIN).
-- ===========================================================================
create or replace function public.admin_seller_list(
  p_search text default null,
  p_status text default 'ALL',
  p_limit  int  default 20,
  p_offset int  default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_status text := coalesce(nullif(upper(btrim(p_status)), ''), 'ALL');
  v_limit  int  := greatest(1, least(coalesce(p_limit, 20), 100));
  v_offset int  := greatest(0, coalesce(p_offset, 0));
  v_result jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHENTICATED');
  end if;
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ADMIN');
  end if;

  with base as (
    select p.*
    from public.profiles p
    where p.role = 'seller'
      and (v_status = 'ALL' or p.account_status = v_status)
      and (
        v_search is null
        or coalesce(p.full_name, '') ilike '%' || v_search || '%'
        or coalesce(p.email, '') ilike '%' || v_search || '%'
        or coalesce(p.phone, '') ilike '%' || v_search || '%'
      )
  ),
  agg as (
    select
      b.id,
      count(*) filter (where s.status = 'PENDING') as pending_count,
      count(*) filter (where s.status = 'SOLD')    as sold_count,
      count(*) filter (where s.status = 'PAID')    as paid_count,
      max(greatest(s.created_at, coalesce(s.updated_at, s.created_at))) as last_sale_activity
    from base b
    left join public.sales s on s.seller_id = b.id and s.operation_type = 'CUBA'
    group by b.id
  ),
  page_rows as (
    select b.*, coalesce(a.pending_count, 0) as pending_count,
           coalesce(a.sold_count, 0) as sold_count, coalesce(a.paid_count, 0) as paid_count,
           a.last_sale_activity
    from base b
    left join agg a on a.id = b.id
    order by b.created_at desc
    limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'ok', true,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'sellerId', r.id,
        'fullName', r.full_name,
        'email', r.email,
        'phone', r.phone,
        'accountStatus', r.account_status,
        'createdAt', r.created_at,
        'invitedAt', r.invited_at,
        'suspendedAt', r.suspended_at,
        'suspensionReason', r.suspension_reason,
        'pendingCount', r.pending_count,
        'soldCount', r.sold_count,
        'paidCount', r.paid_count,
        'lastActivityAt', greatest(coalesce(r.last_sale_activity, r.created_at), r.created_at)
      ) order by r.created_at desc)
      from page_rows r
    ), '[]'::jsonb),
    'page', (v_offset / v_limit)::int + 1,
    'pageSize', v_limit,
    'totalCount', (select count(*) from base)
  )
  into v_result;

  return v_result;
end;
$$;
revoke all on function public.admin_seller_list(text, text, int, int) from public, anon;
grant execute on function public.admin_seller_list(text, text, int, int) to authenticated;

-- ===========================================================================
-- 9. admin_seller_detail — ficha completa de un vendedor (ADMIN).
-- ===========================================================================
create or replace function public.admin_seller_detail(p_seller_id uuid)
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
  if not exists (select 1 from public.profiles where id = p_seller_id and role = 'seller') then
    return jsonb_build_object('ok', false, 'code', 'SELLER_NOT_FOUND');
  end if;

  select jsonb_build_object(
    'ok', true,
    'profile', (
      select jsonb_build_object(
        'sellerId', p.id, 'fullName', p.full_name, 'email', p.email, 'phone', p.phone,
        'accountStatus', p.account_status, 'createdAt', p.created_at,
        'invitedAt', p.invited_at,
        'invitedByName', (select ip.full_name from public.profiles ip where ip.id = p.invited_by),
        'suspendedAt', p.suspended_at,
        'suspendedByName', (select sp.full_name from public.profiles sp where sp.id = p.suspended_by),
        'suspensionReason', p.suspension_reason,
        'reactivatedAt', p.reactivated_at
      )
      from public.profiles p where p.id = p_seller_id
    ),
    'invitation', (
      select jsonb_build_object('id', i.id, 'email', i.email, 'status', i.status, 'invitedAt', i.invited_at, 'acceptedAt', i.accepted_at)
      from public.seller_invitations i
      where i.invited_user_id = p_seller_id
      order by i.created_at desc limit 1
    ),
    'commercial', (
      select jsonb_build_object(
        'pendingCount', count(*) filter (where s.status = 'PENDING'),
        'soldCount', count(*) filter (where s.status = 'SOLD'),
        'paidCount', count(*) filter (where s.status = 'PAID'),
        'unitsSold', (
          select count(*) from public.sale_units su
          join public.sales s2 on s2.id = su.sale_id
          where s2.seller_id = p_seller_id and s2.status in ('SOLD', 'PAID')
        ),
        'revenueCents', coalesce(sum(s.sale_total_cents) filter (where s.status in ('SOLD', 'PAID')), 0)
      )
      from public.sales s
      where s.seller_id = p_seller_id and s.operation_type = 'CUBA'
    ),
    'recentSales', coalesce((
      select jsonb_agg(jsonb_build_object(
        'saleId', s.id, 'saleNumber', s.sale_number, 'status', s.status,
        'saleDate', coalesce(s.sale_date, s.created_at::date),
        'saleTotalCents', s.sale_total_cents,
        'buyerName', (select nullif(btrim(coalesce(sp.first_name, '') || ' ' || coalesce(sp.last_name, '')), '')
                      from public.sale_parties sp where sp.sale_id = s.id and sp.party_role = 'PRIMARY_BUYER')
      ) order by coalesce(s.sale_date, s.created_at::date) desc, s.created_at desc)
      from (
        select * from public.sales
        where seller_id = p_seller_id and operation_type = 'CUBA'
        order by coalesce(sale_date, created_at::date) desc, created_at desc
        limit 8
      ) s
    ), '[]'::jsonb),
    'recentEvents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'eventType', e.event_type, 'actorName', (select ap.full_name from public.profiles ap where ap.id = e.actor_id),
        'reason', e.reason, 'createdAt', e.created_at
      ) order by e.created_at desc)
      from (
        select * from public.seller_account_events
        where seller_id = p_seller_id
        order by created_at desc
        limit 15
      ) e
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;
revoke all on function public.admin_seller_detail(uuid) from public, anon;
grant execute on function public.admin_seller_detail(uuid) to authenticated;
