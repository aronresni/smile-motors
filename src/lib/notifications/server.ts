import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  NOTIFICATION_COLUMNS,
  NOTIFICATIONS_PAGE_SIZE,
  toNotificationItem,
  type NotificationItem,
  type NotificationRow,
} from "@/lib/notifications/types";

/** No leídas del usuario autenticado (RPC con índice parcial, sin traer filas). */
export async function getUnreadNotificationCount(): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("notification_unread_count");
  return error || typeof data !== "number" ? 0 : data;
}

export interface NotificationPage {
  items: NotificationItem[];
  total: number;
  page: number;
  pageCount: number;
}

/**
 * Página de notificaciones del usuario autenticado, paginada en el servidor.
 * RLS ya limita a las propias; el filtro por destinatario además usa el índice.
 */
export async function listNotifications(
  userId: string,
  { page = 1, unreadOnly = false }: { page?: number; unreadOnly?: boolean } = {},
): Promise<NotificationPage> {
  const supabase = await createClient();
  const current = Math.max(1, Math.floor(page));
  const from = (current - 1) * NOTIFICATIONS_PAGE_SIZE;
  let query = supabase
    .from("notifications")
    .select(NOTIFICATION_COLUMNS, { count: "exact" })
    .eq("recipient_user_id", userId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + NOTIFICATIONS_PAGE_SIZE - 1);
  if (unreadOnly) query = query.is("read_at", null);

  const { data, count, error } = await query;
  if (error) return { items: [], total: 0, page: current, pageCount: 1 };
  const total = count ?? 0;
  return {
    items: ((data ?? []) as NotificationRow[]).map(toNotificationItem),
    total,
    page: current,
    pageCount: Math.max(1, Math.ceil(total / NOTIFICATIONS_PAGE_SIZE)),
  };
}
