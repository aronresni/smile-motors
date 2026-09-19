import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Comisiones del vendedor — SOLO las propias (`sale_commissions.seller_id
 * = auth.uid()`, verificado en la RPC, nunca un id del navegador). */
export interface SellerCommissionKpis {
  pendingCount: number;
  eligibleCount: number;
  pendingAmountCents: number;
  eligibleAmountCents: number;
}

const EMPTY_KPIS: SellerCommissionKpis = {
  pendingCount: 0,
  eligibleCount: 0,
  pendingAmountCents: 0,
  eligibleAmountCents: 0,
};

export async function getSellerCommissionKpis(): Promise<SellerCommissionKpis> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_commission_kpis");
  if (error || !data) return EMPTY_KPIS;
  const res = data as unknown as { ok: boolean } & Partial<SellerCommissionKpis>;
  if (!res.ok) return EMPTY_KPIS;
  return {
    pendingCount: res.pendingCount ?? 0,
    eligibleCount: res.eligibleCount ?? 0,
    pendingAmountCents: res.pendingAmountCents ?? 0,
    eligibleAmountCents: res.eligibleAmountCents ?? 0,
  };
}

export interface SellerCommissionListItem {
  commissionId: string;
  saleId: string;
  saleNumber: string | null;
  soldAt: string | null;
  productName: string;
  variantName: string | null;
  referencePriceCents: number;
  salePriceCents: number;
  priceDifferenceCents: number;
  baseCommissionCents: number;
  sellerDifferenceShareCents: number;
  finalCommissionCents: number;
  status: "PENDING" | "ELIGIBLE" | "VOID";
  eligibleAt: string | null;
}

export async function getSellerCommissionList(
  limit = 30,
  offset = 0,
): Promise<{ items: SellerCommissionListItem[]; total: number }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_commission_list", { p_limit: limit, p_offset: offset });
  if (error || !data) return { items: [], total: 0 };
  const res = data as unknown as { ok: boolean; items?: SellerCommissionListItem[]; total?: number };
  if (!res.ok) return { items: [], total: 0 };
  return { items: res.items ?? [], total: res.total ?? 0 };
}
