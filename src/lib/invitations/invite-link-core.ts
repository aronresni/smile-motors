import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ROUTES } from "@/lib/constants";

/**
 * Núcleo PURO del enlace de invitación (sin `server-only` ni cookies, para
 * poder probarlo desde Node). Lo usan `lib/auth/invite-link.ts` (Server
 * Actions) y las pruebas.
 *
 * El enlace es el de siempre: `generateLink({ type: "invite" })` de Supabase
 * Auth (no envía correo) + ruta propia `/auth/invitacion?token_hash=…`, que
 * canjea el token en el servidor SOLO ante el POST de la persona (abrirla no
 * gasta el enlace). Un solo uso; generar otro invalida el
 * anterior. El token NUNCA se guarda: solo su resumen SHA-256
 * (`linkDigest`), que no autentica y sirve para comprobar que un correo lleva
 * el enlace vigente.
 */
export interface InviteLink {
  userId: string;
  email: string;
  url: string;
  /** SHA-256 (hex) del token del enlace — ver `seller_invitations.link_digest`. */
  digest: string;
}

export type InviteLinkError = "EMAIL_ALREADY_REGISTERED" | "INVITE_FAILED";

/**
 * Tipo de token del enlace. Normalmente `invite`; `recovery` es el respaldo
 * para una cuenta INVITADA que ya quedó CONFIRMADA sin contraseña — Supabase
 * no permite volver a invitarla, y sin esto el admin no tendría forma de
 * reenviarle nada (le pasó a todas las invitaciones que gastó la vista previa
 * de WhatsApp antes de la corrección). Da el mismo acceso temporal para poner
 * la contraseña, y solo se genera si el perfil sigue en INVITED.
 */
export type InviteTokenType = "invite" | "recovery";

export function isInviteTokenType(value: unknown): value is InviteTokenType {
  return value === "invite" || value === "recovery";
}

export interface InviteMetadata {
  full_name?: string;
  role?: "seller";
  account_status?: "INVITED";
  phone?: string;
}

export function linkDigest(tokenHash: string): string {
  return createHash("sha256").update(tokenHash).digest("hex");
}

/** Arma la URL pública del enlace a partir del token. */
export function buildInviteUrl(
  siteUrl: string,
  tokenHash: string,
  type: InviteTokenType = "invite",
): string {
  const url = new URL(`${siteUrl.replace(/\/+$/, "")}${ROUTES.authInvite}`);
  url.searchParams.set("token_hash", tokenHash);
  // `invite` es el valor por defecto: no se escribe, así los enlaces de
  // siempre siguen siendo exactamente iguales.
  if (type !== "invite") url.searchParams.set("type", type);
  return url.toString();
}

/**
 * Valida que una URL sea un enlace de invitación de ESTA aplicación (mismo
 * origen que `siteUrl`, ruta de invitación, token presente) y devuelve su
 * resumen. `null` si no lo es.
 */
export function inviteUrlDigest(inviteUrl: string, siteUrl: string): string | null {
  let url: URL;
  let site: URL;
  try {
    url = new URL(inviteUrl);
    site = new URL(siteUrl);
  } catch {
    return null;
  }
  if (url.origin !== site.origin || url.pathname !== ROUTES.authInvite) return null;
  const token = url.searchParams.get("token_hash");
  if (!token || !/^[A-Za-z0-9_-]{20,200}$/.test(token)) return null;
  return linkDigest(token);
}

export async function generateInviteLink(
  admin: SupabaseClient,
  siteUrl: string,
  email: string,
  metadata: InviteMetadata = {},
): Promise<{ ok: true; link: InviteLink } | { ok: false; code: InviteLinkError }> {
  // Un enlace de invitación abre sesión como esa persona: solo se permite
  // para cuentas que están realmente INVITADAS (o que aún no existen). Nunca
  // para una cuenta ya activa — ni siquiera de otro vendedor o admin.
  const { data: existing } = await admin
    .from("profiles")
    .select("account_status")
    .eq("email", email)
    .maybeSingle();
  if (existing && existing.account_status !== "INVITED") {
    return { ok: false, code: "EMAIL_ALREADY_REGISTERED" };
  }

  const invited = await admin.auth.admin.generateLink({
    type: "invite",
    email,
    options: { data: metadata },
  });
  let type: InviteTokenType = "invite";
  let user = invited.data?.user;
  let tokenHash = invited.data?.properties?.hashed_token;

  if (invited.error || !user || !tokenHash) {
    // Supabase rechaza invitar a una cuenta que ya está confirmada. Si su
    // perfil sigue INVITED, nunca llegó a crear contraseña: se le manda un
    // enlace de recuperación, que sirve para lo mismo. Sin perfil previo no
    // hay nada que revivir.
    if (!existing) return { ok: false, code: "INVITE_FAILED" };
    const recovery = await admin.auth.admin.generateLink({ type: "recovery", email });
    user = recovery.data?.user;
    tokenHash = recovery.data?.properties?.hashed_token;
    if (recovery.error || !user || !tokenHash) {
      return { ok: false, code: "INVITE_FAILED" };
    }
    type = "recovery";
  }

  return {
    ok: true,
    link: {
      userId: user.id,
      email,
      url: buildInviteUrl(siteUrl, tokenHash, type),
      digest: linkDigest(tokenHash),
    },
  };
}
