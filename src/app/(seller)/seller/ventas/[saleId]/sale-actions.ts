"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import { ROUTES } from "@/lib/constants";

/**
 * Acciones de revisión / financiación / cobro. La autorización REAL vive en
 * cada RPC (`is_admin()` para las de administrador; propietario-o-admin para
 * las que también puede ejercer el vendedor) — esto es defensa en
 * profundidad, no la única puerta. Ninguna usa service_role.
 *
 * Flujo comercial: DRAFT -(vendedor)-> PENDING -(VENDEDOR, solo con
 * contratos obligatorios firmados)-> SOLD -(ADMIN revisa el cierre)-> sigue
 * SOLD con cobro pendiente, o -(ADMIN, siempre acción explícita)-> PAID.
 * El cobro (`settlement_status`) es un concepto DISTINTO de `sales.status`.
 */

export interface RpcOk {
  ok: true;
  [key: string]: unknown;
}
export interface RpcFail {
  ok: false;
  code: string;
  errors?: string[];
  /** Solo `CONTRACT_UNSIGNED`: nombres de proveedores con contrato sin firmar. */
  providers?: string[];
}
export type RpcResult = RpcOk | RpcFail;

function revalidateSale(saleId: string) {
  revalidatePath(ROUTES.seller);
  revalidatePath(ROUTES.sellerVentas);
  revalidatePath(`${ROUTES.sellerVentas}/${saleId}`);
  revalidatePath(ROUTES.admin);
}

async function callRpc(
  name:
    | "mark_sale_sold"
    | "return_sale_to_draft"
    | "admin_confirm_sale_closing"
    | "mark_financing_sent"
    | "mark_financing_signed"
    | "mark_financing_accredited"
    | "mark_payment_allocation_settled"
    | "admin_mark_sale_paid"
    | "attach_financing_contract_document",
  args: Record<string, unknown>,
): Promise<RpcResult> {
  await requireUser();
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- firmas variadas por RPC
  const { data, error } = await (supabase.rpc as any)(name, args);
  if (error || !data) return { ok: false, code: "UNEXPECTED" };
  return data as RpcResult;
}

/** PENDING -> SOLD. Solo el VENDEDOR dueño de la venta (verificado en la
 * RPC); exige que todo contrato de financiación obligatorio esté firmado. */
export async function markSaleSold(saleId: string): Promise<RpcResult> {
  const res = await callRpc("mark_sale_sold", { p_sale_id: saleId });
  if (res.ok) revalidateSale(saleId);
  return res;
}

/** PENDING -> DRAFT, con motivo. Solo admin (verificado en la RPC). */
export async function returnSaleToDraft(
  saleId: string,
  reason: string,
): Promise<RpcResult> {
  const res = await callRpc("return_sale_to_draft", {
    p_sale_id: saleId,
    p_reason: reason,
  });
  if (res.ok) revalidateSale(saleId);
  return res;
}

/** Crea el contrato de financiación (ENVIADO). Solo admin. */
export async function markFinancingSent(
  saleId: string,
  paymentAllocationId: string,
): Promise<RpcResult> {
  const res = await callRpc("mark_financing_sent", {
    p_sale_id: saleId,
    p_payment_allocation_id: paymentAllocationId,
  });
  if (res.ok) revalidateSale(saleId);
  return res;
}

/** Marca FIRMADO. Vendedor dueño de la venta o admin. */
export async function markFinancingSigned(
  saleId: string,
  contractId: string,
  note?: string,
): Promise<RpcResult> {
  const res = await callRpc("mark_financing_signed", {
    p_contract_id: contractId,
    p_note: note ?? null,
  });
  if (res.ok) revalidateSale(saleId);
  return res;
}

/** Marca ACREDITADO y recalcula PAID. Solo admin. */
export async function markFinancingAccredited(
  saleId: string,
  contractId: string,
  note?: string,
): Promise<RpcResult> {
  const res = await callRpc("mark_financing_accredited", {
    p_contract_id: contractId,
    p_note: note ?? null,
  });
  if (res.ok) revalidateSale(saleId);
  return res;
}

/** Liquida un pago directo (CARD/ZELLE/INTERNAL) y recalcula PAID. Solo admin. */
export async function markPaymentAllocationSettled(
  saleId: string,
  allocationId: string,
): Promise<RpcResult> {
  const res = await callRpc("mark_payment_allocation_settled", {
    p_allocation_id: allocationId,
  });
  if (res.ok) revalidateSale(saleId);
  return res;
}

/** Opción A del cierre de una venta SOLD: "Cierre pendiente a cobrar" —
 * registra la revisión del admin (auditoría) sin cambiar `sales.status`.
 * Solo admin. */
export async function confirmSaleClosing(saleId: string): Promise<RpcResult> {
  const res = await callRpc("admin_confirm_sale_closing", { p_sale_id: saleId });
  if (res.ok) revalidateSale(saleId);
  return res;
}

/** Opción B del cierre de una venta SOLD: SOLD -> PAID. SIEMPRE una acción
 * humana explícita del admin (nunca automática); vuelve a validar la
 * liquidación completa server-side. Solo admin. */
export async function adminMarkSalePaid(saleId: string): Promise<RpcResult> {
  const res = await callRpc("admin_mark_sale_paid", { p_sale_id: saleId });
  if (res.ok) revalidateSale(saleId);
  return res;
}

/** Adjunta el documento del contrato ya subido a Storage. Dueño o admin. */
export async function attachFinancingContractDocument(
  saleId: string,
  contractId: string,
  storagePath: string,
  mimeType: string | null,
  fileSizeBytes: number | null,
): Promise<RpcResult> {
  const res = await callRpc("attach_financing_contract_document", {
    p_contract_id: contractId,
    p_storage_path: storagePath,
    p_mime_type: mimeType,
    p_file_size_bytes: fileSizeBytes,
  });
  if (res.ok) revalidateSale(saleId);
  return res;
}
