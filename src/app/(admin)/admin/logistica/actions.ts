"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireZone } from "@/lib/auth/session";
import { ROUTES } from "@/lib/constants";

/**
 * Acciones de Logística. Ambas pasan por RPC `SECURITY DEFINER` que vuelven
 * a exigir `is_admin()` server-side. `updateLogisticsStatus` solo admite el
 * siguiente paso normal (forward-only) o ON_HOLD (motivo obligatorio);
 * `correctLogisticsStatus` es la única vía para mover hacia atrás o saltar
 * pasos, siempre con motivo auditado — nunca borra el evento original.
 */
export interface RpcResult {
  ok: boolean;
  code?: string;
  [key: string]: unknown;
}

function revalidateAfterLogisticsChange(saleId?: string) {
  revalidatePath(ROUTES.adminLogistica);
  revalidatePath(ROUTES.adminAlertas);
  revalidatePath(ROUTES.adminActividad);
  revalidatePath(ROUTES.admin);
  if (saleId) {
    revalidatePath(`${ROUTES.adminVentas}/${saleId}`);
    revalidatePath(`${ROUTES.sellerVentas}/${saleId}`);
  }
}

export async function updateLogisticsStatus(
  saleUnitId: string,
  newStatus: string,
  note: string | undefined,
  saleId?: string,
): Promise<RpcResult> {
  await requireZone("admin");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_logistics_update_status", {
    p_sale_unit_id: saleUnitId,
    p_new_status: newStatus,
    p_note: note || undefined,
  });
  if (error || !data) return { ok: false, code: "UNEXPECTED" };
  const res = data as RpcResult;
  if (res.ok) revalidateAfterLogisticsChange(saleId);
  return res;
}

export async function correctLogisticsStatus(
  saleUnitId: string,
  newStatus: string,
  reason: string,
  saleId?: string,
): Promise<RpcResult> {
  await requireZone("admin");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_logistics_correct_status", {
    p_sale_unit_id: saleUnitId,
    p_new_status: newStatus,
    p_reason: reason,
  });
  if (error || !data) return { ok: false, code: "UNEXPECTED" };
  const res = data as RpcResult;
  if (res.ok) revalidateAfterLogisticsChange(saleId);
  return res;
}
