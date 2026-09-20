"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ROUTES } from "@/lib/constants";
import { isInviteTokenType } from "@/lib/invitations/invite-link-core";

export interface RedeemInviteState {
  error: string | null;
}

/**
 * Canjea el token de un solo uso de la invitación por la sesión temporal y
 * lleva a crear la contraseña.
 *
 * Solo se ejecuta ante un POST del propio destinatario (ver `page.tsx`):
 * NUNCA al abrir el enlace, porque quien abre primero un enlace compartido
 * por WhatsApp o por correo suele ser un rastreador de vistas previas, no la
 * persona.
 */
export async function redeemInviteAction(
  _prev: RedeemInviteState,
  formData: FormData,
): Promise<RedeemInviteState> {
  const tokenHash = String(formData.get("token_hash") ?? "").trim();
  if (!tokenHash) redirect(`${ROUTES.login}?error=invite_invalid`);

  // El respaldo para una cuenta ya confirmada usa un token de recuperación
  // (ver `invite-link-core.ts`); cualquier otro valor se ignora.
  const raw = formData.get("type");
  const type = isInviteTokenType(raw) ? raw : "invite";

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) redirect(`${ROUTES.login}?error=invite_invalid`);

  redirect(ROUTES.authAcceptInvite);
}
