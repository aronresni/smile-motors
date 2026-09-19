"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireZone } from "@/lib/auth/session";
import { ROUTES } from "@/lib/constants";

/**
 * Acciones de administración del Centro de Aprobaciones. TODAS pasan por
 * RPC `SECURITY DEFINER` que vuelven a exigir `is_admin()` server-side —
 * mismo patrón que el resto del Admin. `requireZone("admin")` es la
 * primera barrera; la RPC es la segunda y definitiva.
 */
export interface RpcResult {
  ok: boolean;
  code?: string;
  [key: string]: unknown;
}

function revalidateApprovals(saleId?: string) {
  revalidatePath(ROUTES.adminAprobaciones);
  revalidatePath(ROUTES.admin);
  if (saleId) {
    revalidatePath(`${ROUTES.adminVentas}/${saleId}`);
    revalidatePath(`${ROUTES.sellerVentas}/${saleId}`);
  }
}

export async function approveSaleEditRequest(requestId: string, saleId: string): Promise<RpcResult> {
  await requireZone("admin");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("approve_sale_edit_request", { p_request_id: requestId });
  if (error || !data) return { ok: false, code: "UNEXPECTED" };
  const res = data as RpcResult;
  if (res.ok) {
    revalidatePath(`${ROUTES.adminAprobaciones}/ediciones/${requestId}`);
    revalidateApprovals(saleId);
  }
  return res;
}

export async function rejectSaleEditRequest(requestId: string, saleId: string, reviewNote: string): Promise<RpcResult> {
  await requireZone("admin");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reject_sale_edit_request", {
    p_request_id: requestId,
    p_review_note: reviewNote,
  });
  if (error || !data) return { ok: false, code: "UNEXPECTED" };
  const res = data as RpcResult;
  if (res.ok) {
    revalidatePath(`${ROUTES.adminAprobaciones}/ediciones/${requestId}`);
    revalidateApprovals(saleId);
  }
  return res;
}
