import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { buildInvitationEmail, firstNameOf } from "@/lib/invitations/invitation-email";

/**
 * Envío del correo de invitación — orquestación PURA (el transporte y el
 * cliente de base se inyectan: Resend en producción, uno de captura en las
 * pruebas).
 *
 * El correo es solo un canal ADICIONAL: la invitación y su enlace ya existen
 * cuando se llama a esto, y un fallo aquí NUNCA los deshace. Pasos:
 *   1. `admin_begin_invitation_email`: exige admin, comprueba que el enlace
 *      sea el VIGENTE (resumen) y bloquea envíos duplicados; devuelve el
 *      destinatario DESDE LA BASE (nunca desde el navegador).
 *   2. Envía por el transporte.
 *   3. `admin_finish_invitation_email`: SENT / FAILED + evento de auditoría.
 * El resultado del correo nunca cambia el estado de la cuenta (sigue INVITED
 * hasta que el vendedor acepte).
 */
export interface InvitationMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Evita envíos duplicados en reintentos de red del mismo intento. */
  idempotencyKey: string;
}

export type MailerResult = { ok: true; id: string } | { ok: false; error: string };

export interface InvitationMailer {
  send(message: InvitationMessage): Promise<MailerResult>;
}

export type EmailDeliveryStatus = "SENT" | "FAILED" | "SKIPPED";

export interface EmailDeliveryResult {
  status: EmailDeliveryStatus;
  /** Código corto: NOT_CONFIGURED, resend:<código>, SEND_EXCEPTION, EMAIL_COOLDOWN, STALE_LINK… */
  code?: string;
}

export interface DeliverInvitationInput {
  sellerId: string;
  inviteUrl: string;
  linkDigest: string;
  /** Origen público de la app, para el logo del correo. */
  siteUrl: string;
}

export const INVITATION_LOGO_PATH = "/brand/smile-motors-logo-email.png";

export async function deliverInvitationEmail(
  // Cliente con la sesión del ADMIN (las RPC vuelven a exigir is_admin()).
  db: SupabaseClient<Database>,
  mailer: InvitationMailer | null,
  input: DeliverInvitationInput,
): Promise<EmailDeliveryResult> {
  const { data: begin, error: beginErr } = await db.rpc("admin_begin_invitation_email", {
    p_seller_id: input.sellerId,
    p_link_digest: input.linkDigest,
  });
  const started = begin as { ok?: boolean; code?: string; email?: string; fullName?: string | null; attempt?: number } | null;
  if (beginErr || !started?.ok || !started.email) {
    return { status: "SKIPPED", code: started?.code ?? "UNEXPECTED" };
  }

  const finish = async (sent: boolean, error?: string) => {
    await db.rpc("admin_finish_invitation_email", {
      p_seller_id: input.sellerId,
      p_link_digest: input.linkDigest,
      p_sent: sent,
      p_error: error,
    });
  };

  if (!mailer) {
    await finish(false, "NOT_CONFIGURED");
    return { status: "FAILED", code: "NOT_CONFIGURED" };
  }

  const email = buildInvitationEmail({
    firstName: firstNameOf(started.fullName),
    inviteUrl: input.inviteUrl,
    logoUrl: `${input.siteUrl.replace(/\/+$/, "")}${INVITATION_LOGO_PATH}`,
  });

  let result: MailerResult;
  try {
    result = await mailer.send({
      to: started.email,
      ...email,
      idempotencyKey: `seller-invite-${input.linkDigest.slice(0, 32)}-${started.attempt ?? 1}`,
    });
  } catch {
    result = { ok: false, error: "SEND_EXCEPTION" };
  }

  await finish(result.ok, result.ok ? undefined : result.error);
  return result.ok ? { status: "SENT" } : { status: "FAILED", code: result.error };
}
