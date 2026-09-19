-- ===========================================================================
-- Autenticación y control de acceso por rol — base
--   * Tabla public.profiles (identidad + rol + estado)
--   * Helpers public.is_admin() / public.user_role() para políticas RLS
--   * Alta automática de perfil al registrarse un usuario
--   * Row Level Security en profiles
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Tabla de perfiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text,
  role        text not null default 'seller' check (role in ('admin', 'seller')),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.profiles is
  'Perfil y rol por usuario. La identidad proviene de auth.users; el rol NUNCA debe leerse desde el cliente.';

-- ---------------------------------------------------------------------------
-- 2. Helpers de rol (para las políticas RLS de ésta y otras tablas)
--    security definer + search_path fijo => no dependen de RLS y no recursan.
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
      and is_active
  );
$$;

create or replace function public.user_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select role
  from public.profiles
  where id = auth.uid() and is_active;
$$;

-- ---------------------------------------------------------------------------
-- 3. Triggers de mantenimiento
-- ---------------------------------------------------------------------------

-- updated_at automático
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Un usuario no puede cambiarse el rol ni el estado a sí mismo; solo un admin.
create or replace function public.protect_profile_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    new.role := old.role;
    new.is_active := old.is_active;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_privileged on public.profiles;
create trigger profiles_protect_privileged
  before update on public.profiles
  for each row execute function public.protect_profile_privileged_columns();

-- Crear el perfil al registrarse el usuario en auth.users.
-- El rol se toma de user_metadata.role si es válido; si no, 'seller'.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    case
      when coalesce(new.raw_user_meta_data ->> 'role', '') in ('admin', 'seller')
        then new.raw_user_meta_data ->> 'role'
      else 'seller'
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 4. Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

grant select, update on public.profiles to authenticated;

drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin"
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_update_own_or_admin" on public.profiles;
create policy "profiles_update_own_or_admin"
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_admin_insert" on public.profiles;
create policy "profiles_admin_insert"
  on public.profiles
  for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "profiles_admin_delete" on public.profiles;
create policy "profiles_admin_delete"
  on public.profiles
  for delete
  to authenticated
  using (public.is_admin());

-- ===========================================================================
-- PATRÓN para tablas de negocio futuras (ejemplo, comentado):
--
--   alter table public.motos enable row level security;
--
--   -- Lectura: cualquier usuario activo autenticado
--   create policy "motos_read_authenticated"
--     on public.motos for select to authenticated
--     using (public.user_role() is not null);
--
--   -- Escritura sensible: solo admin
--   create policy "motos_write_admin"
--     on public.motos for all to authenticated
--     using (public.is_admin()) with check (public.is_admin());
--
--   -- o por propiedad del vendedor:
--   create policy "ventas_seller_own"
--     on public.ventas for select to authenticated
--     using (seller_id = auth.uid() or public.is_admin());
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Tras aplicar la migración, promover tu usuario a admin (una sola vez):
--   update public.profiles set role = 'admin' where email = 'TU_CORREO';
-- ---------------------------------------------------------------------------
