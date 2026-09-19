"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireZone } from "@/lib/auth/session";
import { ROUTES } from "@/lib/constants";
import type { Json } from "@/types/database.types";

/**
 * Solicitud de edición de venta — el vendedor NUNCA muta la venta
 * directamente (ver el cierre del bypass en `update_confirmed_cuba_sale`):
 * solo crea una fila en `sale_edit_requests`, que un admin aprueba o
 * rechaza desde el Centro de Aprobaciones.
 */
export interface RpcResult {
  ok: boolean;
  code?: string;
  [key: string]: unknown;
}

function revalidateSale(saleId: string) {
  revalidatePath(ROUTES.sellerVentas);
  revalidatePath(`${ROUTES.sellerVentas}/${saleId}`);
  revalidatePath(ROUTES.adminAprobaciones);
  revalidatePath(ROUTES.admin);
}

export interface SaleEditChange {
  path: string;
  oldValue: string | null;
  newValue: string | null;
}

/** Snapshot actual de la venta (mismos campos editables) — el cliente lo
 * usa para precargar el editor y calcular el diff antes de enviar. */
export async function getSaleEditSnapshot(saleId: string): Promise<{ payload: Record<string, unknown>; flat: Record<string, string | null> } | null> {
  await requireZone("seller");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sale_edit_snapshot", { p_sale_id: saleId });
  if (error || !data) return null;
  const res = data as unknown as { ok: boolean; payload?: Record<string, unknown>; flat?: Record<string, string | null> };
  if (!res.ok) return null;
  return { payload: res.payload ?? {}, flat: res.flat ?? {} };
}

export async function requestSaleEdit(saleId: string, reason: string, changes: SaleEditChange[]): Promise<RpcResult> {
  await requireZone("seller");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_sale_edit", {
    p_sale_id: saleId,
    p_reason: reason,
    p_changes: changes as unknown as Json,
  });
  if (error || !data) return { ok: false, code: "UNEXPECTED" };
  const res = data as RpcResult;
  if (res.ok) revalidateSale(saleId);
  return res;
}

export async function cancelSaleEditRequest(requestId: string, saleId: string): Promise<RpcResult> {
  await requireZone("seller");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cancel_sale_edit_request", { p_request_id: requestId });
  if (error || !data) return { ok: false, code: "UNEXPECTED" };
  const res = data as RpcResult;
  if (res.ok) revalidateSale(saleId);
  return res;
}
