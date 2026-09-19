import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { ROUTES } from "@/lib/constants";

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
 * El enlace es una credencial de un solo uso: se le entrega al administrador
 * para que se lo pase al vendedor (WhatsApp, correo, etc.) y NUNCA se guarda
 * en la base ni se escribe en logs.
 */
export interface InviteLink {
  userId: string;
  email: string;
  url: string;
}

export type InviteLinkError = "EMAIL_ALREADY_REGISTERED" | "INVITE_FAILED";

interface InviteMetadata {
  full_name?: string;
  role?: "seller";
  account_status?: "INVITED";
  phone?: string;
}

export async function createInviteLink(
  email: string,
  metadata: InviteMetadata = {},
): Promise<{ ok: true; link: InviteLink } | { ok: false; code: InviteLinkError }> {
  const admin = createAdminClient();

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
  if (error || !data?.user || !data.properties?.hashed_token) {
    return { ok: false, code: "INVITE_FAILED" };
  }

  const url = new URL(`${env.NEXT_PUBLIC_SITE_URL}${ROUTES.authInvite}`);
  url.searchParams.set("token_hash", data.properties.hashed_token);

  return { ok: true, link: { userId: data.user.id, email, url: url.toString() } };
}
