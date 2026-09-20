import "server-only";

import { Resend } from "resend";
import type { InvitationMailer } from "@/lib/invitations/deliver-invitation-email";

/**
 * Transporte Resend para el correo de invitación. SOLO servidor: la clave
 * (`RESEND_API_KEY`) jamás lleva prefijo `NEXT_PUBLIC_` ni llega al
 * navegador.
 *
 * Configuración (variables de entorno del servidor):
 *   RESEND_API_KEY               clave de API de Resend.
 *   SMILE_INVITATION_FROM_EMAIL  remitente de un dominio VERIFICADO en Resend,
 *                                p. ej. "Smile Motors <no-reply@tudominio.com>".
 *
 * Sin alguna de las dos, devuelve `null`: la invitación se crea igual y el
 * correo queda FAILED con el código NOT_CONFIGURED (el admin sigue teniendo
 * "Copiar enlace" y "Enviar por WhatsApp").
 */
export function getInvitationMailer(): InvitationMailer | null {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.SMILE_INVITATION_FROM_EMAIL?.trim();
  if (!apiKey || !from) return null;

  const resend = new Resend(apiKey);
  return {
    async send({ to, subject, html, text, idempotencyKey }) {
      const { data, error } = await resend.emails.send(
        { from, to, subject, html, text },
        { idempotencyKey },
      );
      // Solo el código corto del proveedor: nunca el mensaje crudo.
      if (error || !data) return { ok: false, error: `resend:${error?.name ?? "unknown"}` };
      return { ok: true, id: data.id };
    },
  };
}
