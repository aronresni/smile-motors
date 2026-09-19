import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Comisiones — capa de datos de Admin. Todo pasa por RPC `SECURITY DEFINER`
 * de solo lectura (`admin_commission_*`), cada una re-verifica `is_admin()`
 * server-side.
 */
export interface CommissionKpis {
  pendingCount: number;
  eligibleCount: number;
  pendingAmountCents: number;
  eligibleAmountCents: number;
  salesWithCommissionCount: number;
  missingConfigCount: number;
}

const EMPTY_KPIS: CommissionKpis = {
  pendingCount: 0,
  eligibleCount: 0,
  pendingAmountCents: 0,
  eligibleAmountCents: 0,
  salesWithCommissionCount: 0,
  missingConfigCount: 0,
};

export async function getCommissionKpis(): Promise<CommissionKpis> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_commission_kpis");
  if (error || !data) return EMPTY_KPIS;
  const res = data as unknown as { ok: boolean } & Partial<CommissionKpis>;
  if (!res.ok) return EMPTY_KPIS;
  return {
    pendingCount: res.pendingCount ?? 0,
    eligibleCount: res.eligibleCount ?? 0,
    pendingAmountCents: res.pendingAmountCents ?? 0,
    eligibleAmountCents: res.eligibleAmountCents ?? 0,
    salesWithCommissionCount: res.salesWithCommissionCount ?? 0,
    missingConfigCount: res.missingConfigCount ?? 0,
  };
}

export interface CommissionListItem {
  commissionId: string;
  saleId: string;
  saleNumber: string | null;
  sellerId: string;
  sellerName: string;
  productName: string;
  variantName: string | null;
  trackingCode: string | null;
  referencePriceCents: number;
  salePriceCents: number;
  priceDifferenceCents: number;
  baseCommissionCents: number;
  sellerDifferenceShareCents: number;
  finalCommissionCents: number;
  status: "PENDING" | "ELIGIBLE" | "VOID";
  calculatedAt: string;
  eligibleAt: string | null;
  soldAt: string | null;
}

export interface CommissionListFilters {
  search: string;
  status: "ALL" | "PENDING" | "ELIGIBLE";
  sellerId: string | null;
  productId: string | null;
  startDate: string | null;
  endDate: string | null;
  limit: number;
  offset: number;
}

export async function getCommissionList(
  filters: CommissionListFilters,
): Promise<{ items: CommissionListItem[]; total: number }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_commission_list", {
    p_search: filters.search || undefined,
    p_status: filters.status,
    p_seller_id: filters.sellerId || undefined,
    p_product_id: filters.productId || undefined,
    p_start_date: filters.startDate || undefined,
    p_end_date: filters.endDate || undefined,
    p_limit: filters.limit,
    p_offset: filters.offset,
  });
  if (error || !data) return { items: [], total: 0 };
  const res = data as unknown as { ok: boolean; items?: CommissionListItem[]; total?: number };
  if (!res.ok) return { items: [], total: 0 };
  return { items: res.items ?? [], total: res.total ?? 0 };
}
