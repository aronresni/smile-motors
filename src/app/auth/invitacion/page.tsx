import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { RedeemInviteForm } from "@/components/auth/redeem-invite-form";
import { ROUTES } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Invitación",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

/**
 * Entrada del enlace de invitación (ver `lib/auth/invite-link.ts`).
 *
 * ABRIR esta página no consume nada: solo muestra un botón. El canje del
 * token de un solo uso ocurre en el POST de `redeemInviteAction`.
 *
 * Por qué (fallo real, comprobado contra la base): antes esto era un `route.ts`
 * que canjeaba el token en el GET. Al mandar el enlace por WhatsApp, su
 * rastreador de vistas previas descargaba la URL a los pocos segundos y
 * gastaba la invitación — en TODAS las invitaciones enviadas, la cuenta
 * quedaba "confirmada" entre 13 y 47 segundos después de crearse, sin que
 * nadie hubiera puesto una contraseña, y la persona recibía "este enlace ya
 * se usó o caducó". Los rastreadores (y los escáneres de correo) hacen GET,
 * nunca envían un formulario.
 *
 * Se hace con nuestro propio enlace, y no con el correo de Supabase, porque
 * aquel devuelve la sesión en el fragmento `#access_token=…` (invisible para
 * el servidor) y siempre hacia el "Site URL" del proyecto.
 */
export default async function InvitacionPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string | string[] }>;
}) {
  const raw = (await searchParams).token_hash;
  const tokenHash = (Array.isArray(raw) ? raw[0] : raw)?.trim();

  if (!tokenHash) redirect(`${ROUTES.login}?error=invite_invalid`);

  return (
    <AuthShell>
      <div className="mb-7 space-y-1.5 text-center lg:text-left">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-brand">
          Invitación
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Activa tu cuenta
        </h1>
        <p className="text-sm text-muted-foreground">
          Toca continuar y crea tu contraseña para empezar a usar Smile Motors.
        </p>
      </div>
      <RedeemInviteForm tokenHash={tokenHash} />
      <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
        El enlace es personal y de un solo uso: se abre cuando lo confirmas tú.
      </p>
    </AuthShell>
  );
}
