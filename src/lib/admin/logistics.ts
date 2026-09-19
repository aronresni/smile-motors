import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { LogisticsStatus, SaleUnitLogisticsInfo } from "@/lib/sales/logistics-types";

/**
 * Logística / Envíos — ciclo operativo por `sale_unit`, INDEPENDIENTE de
 * `sales.status`. Ver `20260910330000_admin_logistica.sql`.
 *
 * Los tipos/constantes compartidos con componentes cliente (Seller Sale
 * Detail) viven en `@/lib/sales/logistics-types` (sin `server-only`) — este
 * módulo los re-exporta para no romper imports existentes en el lado Admin,
 * y agrega SOLO las funciones de datos (que si son `server-only`).
 */
export type {
  LogisticsStatus,
  LogisticsEvent,
  SaleUnitLogisticsInfo,
} from "@/lib/sales/logistics-types";
export {
  LOGISTICS_STATUS_LABEL,
  LOGISTICS_NEXT_STATUS,
  LOGISTICS_STATUS_OPTIONS,
} from "@/lib/sales/logistics-types";

export interface LogisticsKpis {
  pendingPreparation: number;
  ready: number;
  dispatched: number;
  inTransit: number;
  inCuba: number;
  readyForDelivery: number;
  delivered: number;
  onHold: number;
}

const EMPTY_KPIS: LogisticsKpis = {
  pendingPreparation: 0, ready: 0, dispatched: 0, inTransit: 0, inCuba: 0, readyForDelivery: 0, delivered: 0, onHold: 0,
};

export async function getLogisticsKpis(): Promise<LogisticsKpis> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_logistics_kpis");
  if (error || !data) return EMPTY_KPIS;
  const res = data as unknown as { ok: boolean } & Partial<LogisticsKpis>;
  if (!res.ok) return EMPTY_KPIS;
  return { ...EMPTY_KPIS, ...res };
}

export interface LogisticsListItem {
  saleUnitId: string;
  saleId: string;
  saleNumber: string | null;
  saleStatus: string;
  productName: string;
  variantName: string | null;
  trackingCode: string | null;
  sellerId: string;
  sellerName: string;
  destination: string | null;
  logisticsStatus: LogisticsStatus;
  lastEventAt: string;
}

export interface LogisticsListFilters {
  status?: LogisticsStatus | "ALL";
  sellerId?: string | null;
  productId?: string | null;
  search?: string | null;
  commercialStatus?: "ALL" | "PENDING" | "SOLD" | "PAID";
  limit?: number;
  offset?: number;
}

export async function getLogisticsList(filters: LogisticsListFilters = {}): Promise<{ items: LogisticsListItem[]; total: number }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_logistics_list", {
    p_status: filters.status ?? "ALL",
    p_seller_id: filters.sellerId ?? undefined,
    p_product_id: filters.productId ?? undefined,
    p_search: filters.search ?? undefined,
    p_commercial_status: filters.commercialStatus ?? "ALL",
    p_limit: filters.limit ?? 50,
    p_offset: filters.offset ?? 0,
  });
  if (error || !data) return { items: [], total: 0 };
  const res = data as unknown as { ok: boolean; items?: LogisticsListItem[]; total?: number };
  if (!res.ok) return { items: [], total: 0 };
  return { items: res.items ?? [], total: res.total ?? 0 };
}

/** Lectura compartida Admin/Seller (RLS + gate propio de la RPC). Por unidad
 * de venta: seguimiento + estado logístico (sin VIN). */
export async function getSaleUnitLogisticsStatus(saleId: string): Promise<SaleUnitLogisticsInfo[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sale_unit_logistics_status", { p_sale_id: saleId });
  if (error || !data) return [];
  return (data as unknown as SaleUnitLogisticsInfo[]) ?? [];
}
