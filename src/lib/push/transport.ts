import "server-only";
import type { PushPayload, PushSendResult, PushTarget, PushTransport } from "@/lib/push/types";

/**
 * Transporte real: Web Push con autenticación VAPID.
 *
 * La clave PRIVADA solo existe aquí (servidor). `web-push` se importa de
 * forma diferida para que no entre en ningún paquete del navegador.
 */

const SEND_TIMEOUT_MS = 10_000;

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/** Configuración VAPID si está completa; `null` si falta algo (push apagado
 * en ese entorno, sin romper nada). */
export function vapidConfig(): VapidConfig | null {
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.WEB_PUSH_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

/** Clave pública para el navegador (no es un secreto). Se entrega desde el
 * servidor en vez de incrustarla en el build: así se puede rotar sin
 * recompilar. */
export function vapidPublicKey(): string | null {
  return vapidConfig()?.publicKey ?? null;
}

function statusOf(error: unknown): number | undefined {
  const code = (error as { statusCode?: unknown })?.statusCode;
  return typeof code === "number" ? code : undefined;
}

export function createWebPushTransport(config: VapidConfig): PushTransport {
  return {
    async send(target: PushTarget, payload: PushPayload): Promise<PushSendResult> {
      try {
        const webpush = (await import("web-push")).default;
        webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
        await webpush.sendNotification(
          { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
          JSON.stringify(payload),
          {
            // Si el teléfono está apagado, que el servicio lo guarde un rato;
            // pasado ese tiempo la notificación sigue en la campana igual.
            TTL: 60 * 60 * 12,
            urgency: "high",
            timeout: SEND_TIMEOUT_MS,
          },
        );
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          statusCode: statusOf(error),
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}
