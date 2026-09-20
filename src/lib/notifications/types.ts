/**
 * Notificaciones personales (tabla `notifications`, ver migración
 * 20260923120000). Solo las crean triggers de dominio en la base; el cliente
 * las lee (RLS: solo las propias) y las marca leídas vía RPC.
 */
export type NotificationType =
  | "SALE_SUBMITTED"
  | "SALE_MARKED_SOLD"
  | "SALE_MARKED_PAID"
  | "SALE_RETURNED_TO_DRAFT"
  | "CONTRACT_SENT"
  | "CONTRACT_SIGNED"
  | "CONTRACT_ACCREDITED"
  | "SALE_EDIT_REQUESTED"
  | "SALE_EDIT_APPROVED"
  | "SALE_EDIT_REJECTED"
  | "LIQUIDATION_APPROVED"
  | "LIQUIDATION_PAID"
  | "SELLER_ACTIVATED"
  | "ADMIN_SALE_CORRECTED";

export interface NotificationItem {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  destinationUrl: string | null;
  readAt: string | null;
  createdAt: string;
  /** Contexto corto para toasts ("Synchrony · VTA-2026-000123"). */
  context: string | null;
}

/** Columnas que se leen (nunca `*`: el listado no necesita más). */
export const NOTIFICATION_COLUMNS =
  "id, type, title, message, destination_url, read_at, created_at, metadata" as const;

export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  message: string;
  destination_url: string | null;
  read_at: string | null;
  created_at: string;
  metadata: unknown;
}

export function toNotificationItem(row: NotificationRow): NotificationItem {
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const context = [meta.provider, meta.saleNumber]
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .join(" · ");
  return {
    id: row.id,
    type: row.type as NotificationType,
    title: row.title,
    message: row.message,
    destinationUrl: safeDestination(row.destination_url),
    readAt: row.read_at,
    createdAt: row.created_at,
    context: context || null,
  };
}

/** Solo rutas internas de la app (la base ya lo exige; doble control). */
export function safeDestination(url: string | null | undefined): string | null {
  if (!url) return null;
  return /^\/(admin|seller)(\/[A-Za-z0-9/_-]*)?$/.test(url) ? url : null;
}

export const NOTIFICATIONS_PAGE_SIZE = 20;
