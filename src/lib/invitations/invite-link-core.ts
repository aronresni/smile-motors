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
 * canjea el token en el servidor. Un solo uso; generar otro invalida el
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
export function buildInviteUrl(siteUrl: string, tokenHash: string): string {
  const url = new URL(`${siteUrl.replace(/\/+$/, "")}${ROUTES.authInvite}`);
  url.searchParams.set("token_hash", tokenHash);
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

  const { data, error } = await admin.auth.admin.generateLink({
    type: "invite",
    email,
    options: { data: metadata },
  });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !data?.user || !tokenHash) {
    return { ok: false, code: "INVITE_FAILED" };
  }

  return {
    ok: true,
    link: {
      userId: data.user.id,
      email,
      url: buildInviteUrl(siteUrl, tokenHash),
      digest: linkDigest(tokenHash),
    },
  };
}
