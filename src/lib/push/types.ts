/**
 * Contrato del canal de entrega push. Sin dependencias de servidor, para que
 * el service worker y las pruebas hablen el mismo idioma que el emisor.
 */

/** Lo que viaja dentro del push. NUNCA datos sensibles: ni números de
 * documento, ni fechas de nacimiento, ni URLs de documentos, ni importes que
 * no estén ya en el texto de la notificación. Solo lo que la persona ya ve en
 * su campana. */
export interface PushPayload {
  /** Id de la notificación de la base (autoridad). Sirve de `tag`: dos
   * entregas de la misma notificación no apilan dos avisos. */
  id: string;
  title: string;
  body: string;
  /** Ruta interna de la app, siempre relativa. */
  url: string | null;
  /** No leídas del destinatario en el momento del envío (insignia del icono). */
  unread: number;
}

export interface PushTarget {
  subscriptionId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushSendResult {
  ok: boolean;
  /** Código HTTP del servicio de push (404/410 = endpoint muerto). */
  statusCode?: number;
  error?: string;
}

/** Transporte inyectable: en producción es Web Push (VAPID); en las pruebas,
 * una captura en memoria. Así se puede probar el emisor sin enviar nada a un
 * teléfono real. */
export interface PushTransport {
  send(target: PushTarget, payload: PushPayload): Promise<PushSendResult>;
}

/** Un endpoint que el servicio de push da por muerto: se da de baja sin
 * reintentar. Cualquier otro fallo es temporal y NO borra el dispositivo. */
export function isDeadEndpoint(statusCode?: number): boolean {
  return statusCode === 404 || statusCode === 410;
}
