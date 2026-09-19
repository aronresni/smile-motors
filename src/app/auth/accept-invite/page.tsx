import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AuthShell } from "@/components/auth/auth-shell";
import { AcceptInviteForm } from "@/components/auth/accept-invite-form";
import { ROLES, ROUTES, type Role } from "@/lib/constants";

export const metadata: Metadata = { title: "Activar cuenta" };
export const dynamic = "force-dynamic";

/**
 * Completa la invitación por correo: el vendedor llega aquí con una sesión
 * TEMPORAL (del enlace de invitación, intercambiada en `/auth/callback`).
 *
 * IMPORTANTE: NO se usa `getAuthContext()`/`requireUser()` aquí — esas
 * funciones exigen `is_active` (ver `lib/auth/session.ts`), y una cuenta
 * recién invitada tiene `is_active = false` HASTA que acepta. Se lee la
 * sesión y el perfil directamente (la política RLS de lectura de `profiles`
 * no depende de `is_active`, solo de `id = auth.uid()`).
 */
export default async function AcceptInvitePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`${ROUTES.login}?error=session_expired`);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, account_status, role")
    .eq("id", user.id)
    .single();

  // Cuenta ya activa (enlace reutilizado tras haber aceptado antes): no hay
  // nada que hacer aquí, a su zona normal.
  if (profile && profile.account_status !== "INVITED") {
    const role: Role = profile.role === ROLES.ADMIN ? ROLES.ADMIN : ROLES.SELLER;
    redirect(role === ROLES.ADMIN ? ROUTES.admin : ROUTES.seller);
  }

  return (
    <AuthShell>
      <div className="mb-7 space-y-1.5 text-center lg:text-left">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-brand">Activación de cuenta</p>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {profile?.full_name ? `Bienvenido, ${profile.full_name.split(" ")[0]}` : "Activa tu cuenta"}
        </h1>
        <p className="text-sm text-muted-foreground">
          Crea tu contraseña para empezar a usar Smile Motors. Después entrarás siempre por el mismo inicio de sesión.
        </p>
      </div>
      <AcceptInviteForm />
    </AuthShell>
  );
}
