import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Actividad dealer-wide — proyección en vivo (UNION) sobre las 9 tablas de
 * auditoría por dominio ya existentes + settlement directo. NUNCA copia
 * eventos a una tabla nueva. Ver `20260910310000_admin_actividad_alertas.sql`.
 */
export type ActivityCategory =
  | "VENTAS"
  | "CONTRATOS"
  | "COBROS"
  | "PRODUCTOS"
  | "COMISIONES"
  | "LIQUIDACIONES"
  | "VENDEDORES"
  | "LOGISTICA";

export interface ActivityItem {
  category: ActivityCategory;
  eventType: string;
  occurredAt: string;
  actorId: string | null;
  actorName: string | null;
  actorRole: string | null;
  entityType: string;
  entityId: string;
  saleId: string | null;
  sellerId: string | null;
  title: string;
  description: string | null;
  metadata: Record<string, unknown> | null;
  destinationUrl: string;
}

export interface ActivityFeedFilters {
  category?: ActivityCategory | "ALL";
  actorId?: string | null;
  sellerId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  search?: string | null;
  limit?: number;
  offset?: number;
}

export async function getActivityFeed(
  filters: ActivityFeedFilters = {},
): Promise<{ items: ActivityItem[]; total: number }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_activity_feed", {
    p_category: filters.category ?? "ALL",
    p_actor_id: filters.actorId ?? undefined,
    p_seller_id: filters.sellerId ?? undefined,
    p_start_date: filters.startDate ?? undefined,
    p_end_date: filters.endDate ?? undefined,
    p_search: filters.search ?? undefined,
    p_limit: filters.limit ?? 50,
    p_offset: filters.offset ?? 0,
  });
  if (error || !data) return { items: [], total: 0 };
  const res = data as unknown as { ok: boolean; items?: ActivityItem[]; total?: number };
  if (!res.ok) return { items: [], total: 0 };
  return { items: res.items ?? [], total: res.total ?? 0 };
}
