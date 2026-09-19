import "server-only";
import { createClient } from "@/lib/supabase/server";
import type {
  LiquidationActivity,
  LiquidationAdjustment,
  LiquidationCommissionItem,
} from "@/lib/sales/liquidation-types";

/** Vista del vendedor — SOLO sus propias liquidaciones, y solo una vez
 * APPROVED/PAID (DRAFT es trabajo interno del admin, nunca se expone). */
export interface SellerLiquidationListItem {
  liquidationId: string;
  weekStart: string;
  weekEnd: string;
  status: "APPROVED" | "PAID";
  subtotalCents: number;
  adjustmentsCents: number;
  totalCents: number;
  paidAt: string | null;
}

export async function getSellerLiquidationList(): Promise<SellerLiquidationListItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_liquidation_list");
  if (error || !data) return [];
  const res = data as unknown as { ok: boolean; items?: SellerLiquidationListItem[] };
  if (!res.ok) return [];
  return res.items ?? [];
}

export interface SellerLiquidationDetail {
  id: string;
  weekStart: string;
  weekEnd: string;
  status: "APPROVED" | "PAID";
  subtotalCents: number;
  adjustmentsCents: number;
  totalCents: number;
  paidAt: string | null;
  paymentReference: string | null;
  activity: LiquidationActivity;
  commissionItems: LiquidationCommissionItem[];
  adjustments: LiquidationAdjustment[];
}

export async function getSellerLiquidationDetail(liquidationId: string): Promise<SellerLiquidationDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_liquidation_detail", { p_liquidation_id: liquidationId });
  if (error || !data) return null;
  const res = data as unknown as { ok: boolean; liquidation?: Record<string, unknown>; activity?: SellerLiquidationDetail["activity"]; commissionItems?: LiquidationCommissionItem[]; adjustments?: LiquidationAdjustment[] };
  if (!res.ok || !res.liquidation) return null;
  const l = res.liquidation;
  return {
    id: l.id as string,
    weekStart: l.weekStart as string,
    weekEnd: l.weekEnd as string,
    status: l.status as SellerLiquidationDetail["status"],
    subtotalCents: (l.subtotalCents as number) ?? 0,
    adjustmentsCents: (l.adjustmentsCents as number) ?? 0,
    totalCents: (l.totalCents as number) ?? 0,
    paidAt: (l.paidAt as string) ?? null,
    paymentReference: (l.paymentReference as string) ?? null,
    activity: res.activity ?? { pending: [], sold: [], paid: [] },
    commissionItems: res.commissionItems ?? [],
    adjustments: res.adjustments ?? [],
  };
}
