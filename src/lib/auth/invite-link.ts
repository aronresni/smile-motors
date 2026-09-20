import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import {
  generateInviteLink,
  inviteUrlDigest,
  type InviteLink,
  type InviteLinkError,
  type InviteMetadata,
} from "@/lib/invitations/invite-link-core";

/**
 * Enlace de invitación PROPIO (no el correo de Supabase).
 *
 * Por qué no `inviteUserByEmail`: el servicio de correo incorporado de
 * Supabase es solo para pruebas (unos pocos envíos por hora: devolvía
 * "email rate limit exceeded"), y su enlace vuelve SIEMPRE al "Site URL" del
 * proyecto con la sesión en el fragmento `#access_token=…`, que el servidor
 * no puede leer. Aquí se genera el token con la API de administración
 * (`generateLink`, que NO envía correo) y se arma un enlace a una ruta
 * propia: `/auth/invitacion?token_hash=…`. Esa ruta canjea el token en el
 * servidor y deja la sesión temporal en cookies.
 *
 * El enlace es una credencial de un solo uso: el admin lo copia / manda por
 * WhatsApp y, además, se intenta enviar por correo (Resend) — siempre el
 * MISMO enlace. Nunca se guarda en la base ni se escribe en logs; solo su
 * resumen SHA-256. La URL pública sale de `NEXT_PUBLIC_SITE_URL`.
 */
export type { InviteLink, InviteLinkError };

export async function createInviteLink(
  email: string,
  metadata: InviteMetadata = {},
): Promise<{ ok: true; link: InviteLink } | { ok: false; code: InviteLinkError }> {
  return generateInviteLink(createAdminClient(), env.NEXT_PUBLIC_SITE_URL, email, metadata);
}

/** Resumen del token si `url` es un enlace de invitación de esta app. */
export function digestOfInviteUrl(url: string): string | null {
  return inviteUrlDigest(url, env.NEXT_PUBLIC_SITE_URL);
}

export function siteUrl(): string {
  return env.NEXT_PUBLIC_SITE_URL;
}
