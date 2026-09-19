import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Alertas — condiciones ACTUALES derivadas del estado autoritativo ya
 * existente (nunca filas persistidas que haya que "resolver" a mano). El
 * total incluye las mismas 4 categorías del Centro de Aprobaciones — se
 * expone `includesApprovalCenter` para dejarlo explícito, nunca un doble
 * conteo oculto. Ver `20260910310000_admin_actividad_alertas.sql`.
 */
export type AlertCategory =
  | "APROBACIONES"
  | "CONTRATOS"
  | "COBROS"
  | "PAGOS"
  | "COMISIONES"
  | "LIQUIDACIONES"
  | "VENDEDORES"
  | "LOGISTICA";

export type AlertPriority = "HIGH" | "MEDIUM" | "LOW";

export interface AlertsSummary {
  total: number;
  categories: Record<AlertCategory, number>;
  includesApprovalCenter: {
    edicionesSolicitadas: number;
    contratosRequierenAccion: number;
    pendientesACobrar: number;
    listasParaPagar: number;
  };
}

const EMPTY_SUMMARY: AlertsSummary = {
  total: 0,
  categories: {
    APROBACIONES: 0, CONTRATOS: 0, COBROS: 0, PAGOS: 0,
    COMISIONES: 0, LIQUIDACIONES: 0, VENDEDORES: 0, LOGISTICA: 0,
  },
  includesApprovalCenter: {
    edicionesSolicitadas: 0, contratosRequierenAccion: 0, pendientesACobrar: 0, listasParaPagar: 0,
  },
};

export async function getAlertsSummary(): Promise<AlertsSummary> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_alerts_summary");
  if (error || !data) return EMPTY_SUMMARY;
  const res = data as unknown as { ok: boolean } & Partial<AlertsSummary>;
  if (!res.ok) return EMPTY_SUMMARY;
  return {
    total: res.total ?? 0,
    categories: { ...EMPTY_SUMMARY.categories, ...res.categories },
    includesApprovalCenter: { ...EMPTY_SUMMARY.includesApprovalCenter, ...res.includesApprovalCenter },
  };
}

export interface AlertItem {
  category: AlertCategory;
  type: string;
  priority: AlertPriority;
  occurredAt: string;
  title: string;
  detail: string;
  sellerId: string | null;
  sellerName: string | null;
  entityType: string;
  entityId: string;
  saleId: string | null;
  amountCents: number | null;
  actionUrl: string;
  actionLabel: string;
}

export interface AlertsListFilters {
  category?: AlertCategory | "ALL";
  priority?: AlertPriority | "ALL";
  sellerId?: string | null;
  limit?: number;
  offset?: number;
}

export async function getAlertsList(
  filters: AlertsListFilters = {},
): Promise<{ items: AlertItem[]; total: number }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_alerts_list", {
    p_category: filters.category ?? "ALL",
    p_priority: filters.priority ?? "ALL",
    p_seller_id: filters.sellerId ?? undefined,
    p_limit: filters.limit ?? 50,
    p_offset: filters.offset ?? 0,
  });
  if (error || !data) return { items: [], total: 0 };
  const res = data as unknown as { ok: boolean; items?: AlertItem[]; total?: number };
  if (!res.ok) return { items: [], total: 0 };
  return { items: res.items ?? [], total: res.total ?? 0 };
}
