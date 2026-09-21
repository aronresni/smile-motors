import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { isDeadEndpoint, type PushPayload, type PushTransport } from "@/lib/push/types";

/**
 * Núcleo PURO de la entrega push (sin `server-only` ni variables de entorno,
 * para poder probarlo desde Node — mismo patrón que el correo de invitación).
 *
 * Garantías que fija este módulo:
 *  · Una notificación de la base → N entregas (una por dispositivo activo del
 *    destinatario). Nunca se crea una segunda notificación.
 *  · El reclamo es atómico (`push_claim_pending`): dos procesos a la vez no
 *    envían lo mismo dos veces.
 *  · Endpoint muerto (404/410) → se da de baja ese dispositivo y no se
 *    reintenta. Cualquier otro fallo es temporal: se registra y el dispositivo
 *    se queda.
 *  · Nada de esto toca la notificación de la base ni la operación de negocio.
 */

export interface FlushResult {
  /** Notificaciones distintas reclamadas en esta pasada. */
  claimed: number;
  sent: number;
  failed: number;
  revoked: number;
}

/** Envíos simultáneos: suficiente para el tamaño del concesionario y sin
 * abrir decenas de conexiones a la vez. */
const CONCURRENCY = 8;

interface ClaimedRow {
  notification_id: string;
  recipient_id: string;
  title: string;
  message: string;
  destination_url: string | null;
  unread_count: number;
  subscription_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

type Admin = SupabaseClient<Database>;

async function inBatches<T>(items: T[], size: number, run: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(run));
  }
}

export async function logPushError(
  admin: Admin,
  source: string,
  message: string,
  context: Record<string, unknown>,
): Promise<void> {
  try {
    await admin.from("notification_delivery_errors").insert({
      source,
      message: message.slice(0, 1000),
      context: context as never,
    });
  } catch {
    /* Ni el registro del fallo puede romper nada. */
  }
}

/** Reclama lo pendiente y lo entrega. Nunca lanza. */
export async function deliverPendingPush(
  admin: Admin,
  transport: PushTransport,
  limit = 100,
): Promise<FlushResult> {
  const result: FlushResult = { claimed: 0, sent: 0, failed: 0, revoked: 0 };

  const { data, error } = await admin.rpc("push_claim_pending", { p_limit: limit });
  if (error || !data) {
    await logPushError(admin, "push:claim", error?.message ?? "sin datos", {});
    return result;
  }

  const rows = data as unknown as ClaimedRow[];
  result.claimed = new Set(rows.map((r) => r.notification_id)).size;

  await inBatches(rows, CONCURRENCY, async (row) => {
    const payload: PushPayload = {
      id: row.notification_id,
      title: row.title,
      body: row.message,
      url: row.destination_url,
      unread: Number(row.unread_count) || 0,
    };

    let sendResult;
    try {
      sendResult = await transport.send(
        {
          subscriptionId: row.subscription_id,
          endpoint: row.endpoint,
          p256dh: row.p256dh,
          auth: row.auth,
        },
        payload,
      );
    } catch (err) {
      sendResult = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    const now = new Date().toISOString();

    if (sendResult.ok) {
      result.sent++;
      await admin
        .from("push_subscriptions")
        .update({ last_used_at: now })
        .eq("id", row.subscription_id);
      return;
    }

    result.failed++;
    const dead = isDeadEndpoint(sendResult.statusCode);
    if (dead) {
      // El servicio de push dice que ese endpoint ya no existe (app
      // desinstalada, permiso retirado): baja sin reintentos.
      result.revoked++;
      await admin
        .from("push_subscriptions")
        .update({ revoked_at: now, updated_at: now })
        .eq("id", row.subscription_id);
    }
    await logPushError(admin, "push:send", sendResult.error ?? "fallo de entrega", {
      notificationId: row.notification_id,
      subscriptionId: row.subscription_id,
      statusCode: sendResult.statusCode ?? null,
      revoked: dead,
    });
  });

  return result;
}
