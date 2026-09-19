"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireZone } from "@/lib/auth/session";
import { ROUTES } from "@/lib/constants";
import type { LiquidationAdjustmentType } from "@/lib/sales/liquidation-types";

/**
 * Acciones del ciclo de vida de la liquidación semanal. TODAS pasan por RPC
 * `SECURITY DEFINER` que vuelven a exigir `is_admin()` server-side. Ninguna
 * de estas acciones recalcula un monto de comisión — solo agrupan, marcan
 * (`liquidation_id`) y avanzan estado (DRAFT → APPROVED → PAID).
 */
export interface RpcResult {
  ok: boolean;
  code?: string;
  [key: string]: unknown;
}

function revalidateLiquidation(liquidationId?: string) {
  revalidatePath(ROUTES.adminLiquidaciones);
  if (liquidationId) revalidatePath(`${ROUTES.adminLiquidaciones}/${liquidationId}`);
}

export async function createLiquidationDraft(sellerId: string, weekStart: string): Promise<RpcResult> {
  await requireZone("admin");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_liquidation_create_draft", {
    p_seller_id: sellerId,
    p_week_start: weekStart,
  });
  if (error || !data) return { ok: false, code: "UNEXPECTED" };
  const res = data as RpcResult;
  if (res.ok) revalidateLiquidation(res.liquidationId as string | undefined);
  return res;
}

export async function refreshLiquidationDraft(liquidationId: string): Promise<RpcResult> {
  await requireZone("admin");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_liquidation_refresh", { p_liquidation_id: liquidationId });
  if (error || !data) return { ok: false, code: "UNEXPECTED" };
  const res = data as RpcResult;
  if (res.ok) revalidateLiquidation(liquidationId);
  return res;
}

export async function addLiquidationAdjustment(
  liquidationId: string,
  type: LiquidationAdjustmentType,
  amountCents: number,
  reason: string,
): Promise<RpcResult> {
  await requireZone("admin");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_liquidation_add_adjustment", {
    p_liquidation_id: liquidationId,
    p_type: type,
    p_amount_cents: amountCents,
    p_reason: reason,
  });
  if (error || !data) return { ok: false, code: "UNEXPECTED" };
  const res = data as RpcResult;
  if (res.ok) revalidateLiquidation(liquidationId);
  return res;
}

export async function approveLiquidation(liquidationId: string): Promise<RpcResult> {
  await requireZone("admin");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_liquidation_approve", { p_liquidation_id: liquidationId });
  if (error || !data) return { ok: false, code: "UNEXPECTED" };
  const res = data as RpcResult;
  if (res.ok) revalidateLiquidation(liquidationId);
  return res;
}

export async function markLiquidationPaid(liquidationId: string, paymentReference: string): Promise<RpcResult> {
  await requireZone("admin");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_liquidation_mark_paid", {
    p_liquidation_id: liquidationId,
    p_payment_reference: paymentReference || undefined,
  });
  if (error || !data) return { ok: false, code: "UNEXPECTED" };
  const res = data as RpcResult;
  if (res.ok) {
    revalidateLiquidation(liquidationId);
    // El estado de pago afecta también la visibilidad del vendedor.
    revalidatePath(ROUTES.sellerLiquidaciones);
  }
  return res;
}
