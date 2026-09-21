import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createWebPushTransport, vapidConfig } from "@/lib/push/transport";
import { deliverPendingPush, type FlushResult } from "@/lib/push/dispatch-core";
import type { PushTransport } from "@/lib/push/types";

/**
 * Vaciado de la bandeja de salida en el servidor.
 *
 * Cómo se dispara (y por qué así): los triggers que crean las notificaciones
 * exigen sesión de usuario, o sea que TODA notificación nace dentro de una
 * petición autenticada de la app. Por eso basta con vaciar la bandeja al
 * final de esa misma petición (`after()` en `getAuthContext`): sin `pg_net`,
 * sin webhooks y sin procesos aparte, y la entrega sale en milisegundos. Si
 * una petición se cortara a medias, la siguiente —de cualquier usuario—
 * recoge lo que quedó pendiente.
 *
 * Corre DESPUÉS de la respuesta: no la demora y no puede afectar a ninguna
 * operación de negocio.
 */

export type { FlushResult };

export interface FlushOutcome extends FlushResult {
  skipped?: "NOT_CONFIGURED" | "NO_SERVICE_ROLE" | "COOLDOWN";
}

const EMPTY: FlushResult = { claimed: 0, sent: 0, failed: 0, revoked: 0 };

/** Varias peticiones seguidas (navegación, revalidaciones) no necesitan
 * consultar la base cada vez. */
const COOLDOWN_MS = 1_000;
let lastFlushAt = 0;

export async function flushPushOutbox(options?: {
  transport?: PushTransport;
  limit?: number;
  ignoreCooldown?: boolean;
}): Promise<FlushOutcome> {
  if (!options?.transport && !options?.ignoreCooldown && Date.now() - lastFlushAt < COOLDOWN_MS) {
    return { ...EMPTY, skipped: "COOLDOWN" };
  }
  lastFlushAt = Date.now();

  let transport = options?.transport;
  if (!transport) {
    const config = vapidConfig();
    // Sin claves VAPID no se reclama nada: lo pendiente sigue pendiente y
    // saldrá cuando el entorno esté configurado.
    if (!config) return { ...EMPTY, skipped: "NOT_CONFIGURED" };
    transport = createWebPushTransport(config);
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ...EMPTY, skipped: "NO_SERVICE_ROLE" };
  }

  try {
    return await deliverPendingPush(createAdminClient(), transport, options?.limit ?? 100);
  } catch {
    // Que la entrega falle no puede notarse en ningún otro sitio.
    return EMPTY;
  }
}
