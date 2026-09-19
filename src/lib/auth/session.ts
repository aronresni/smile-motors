import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ROLES, ROUTES, type Role } from "@/lib/constants";
import { canAccessZone, homeForRole, type Zone } from "@/lib/auth/access";
import type { Profile } from "@/types/auth";

export interface AuthContext {
  userId: string;
  email: string | null;
  profile: Profile;
}

/**
 * Contexto de autenticación de la request actual.
 *
 * La identidad SIEMPRE sale de `supabase.auth.getUser()` (JWT verificado contra
 * Supabase) y el rol SIEMPRE de la fila `public.profiles` (dato confiable en el
 * servidor). Nunca de localStorage ni de estado de cliente.
 *
 * `cache()` deduplica la consulta dentro de un mismo render (layout + page).
 */
export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, is_active")
    .eq("id", user.id)
    .single();

  if (error || !data || !data.is_active) return null;

  const role: Role =
    data.role === ROLES.ADMIN || data.role === ROLES.SELLER
      ? data.role
      : ROLES.SELLER;

  return {
    userId: user.id,
    email: user.email ?? null,
    profile: {
      id: data.id,
      email: data.email,
      full_name: data.full_name,
      role,
      is_active: data.is_active,
    },
  };
});

/** Exige sesión válida y perfil activo; si no, redirige a /login. */
export async function requireUser(redirectTo?: string): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) {
    const qs = redirectTo
      ? `?redirectTo=${encodeURIComponent(redirectTo)}`
      : "";
    redirect(`${ROUTES.login}${qs}`);
  }
  return ctx;
}

/** Exige sesión + rol con acceso a la zona; si no, a la home del rol o a /login. */
export async function requireZone(
  zone: Zone,
  redirectTo?: string,
): Promise<AuthContext> {
  const ctx = await requireUser(redirectTo);
  if (!canAccessZone(ctx.profile.role, zone)) {
    redirect(homeForRole(ctx.profile.role));
  }
  return ctx;
}

/** Exige un rol exacto (para operaciones sensibles puntuales). */
export async function requireRole(role: Role): Promise<AuthContext> {
  const ctx = await requireUser();
  if (ctx.profile.role !== role) {
    redirect(homeForRole(ctx.profile.role));
  }
  return ctx;
}
