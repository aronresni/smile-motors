"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireZone } from "@/lib/auth/session";
import { ROUTES } from "@/lib/constants";

/**
 * Acciones del ADMIN sobre una venta. La autorización REAL vive en cada RPC
 * (`is_admin()`; `mark_sale_sold`/`request_sale_review` aceptan dueño O
 * admin con las MISMAS validaciones). Nunca service_role.
 */
export interface AdminRpcResult {
  ok: boolean;
  code?: string;
  errors?: string[];
  providers?: string[];
  fields?: string[];
  saleUnitIds?: string[];
  [key: string]: unknown;
}

type AdminRpc =
  | "request_sale_review"
  | "mark_sale_sold"
  | "admin_mark_sale_paid"
  | "admin_confirm_sale_closing"
  | "mark_payment_allocation_settled"
  | "return_sale_to_draft"
  | "admin_update_cuba_sale";

async function call(name: AdminRpc, args: Record<string, unknown>): Promise<AdminRpcResult> {
  await requireZone("admin");
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- firmas variadas por RPC
  const { data, error } = await (supabase.rpc as any)(name, args);
  if (error || !data) {
    if (process.env.NODE_ENV !== "production") console.error(`[admin:${name}]`, error);
    return { ok: false, code: "UNEXPECTED" };
  }
  return data as AdminRpcResult;
}

function revalidateSale(saleId: string) {
  revalidatePath(ROUTES.admin);
  revalidatePath(ROUTES.adminVentas);
  revalidatePath(`${ROUTES.adminVentas}/${saleId}`);
  revalidatePath(ROUTES.adminAprobaciones);
  revalidatePath(ROUTES.adminAlertas);
  revalidatePath(ROUTES.sellerVentas);
  revalidatePath(`${ROUTES.sellerVentas}/${saleId}`);
}

async function run(name: AdminRpc, saleId: string, args: Record<string, unknown>) {
  const res = await call(name, args);
  if (res.ok) revalidateSale(saleId);
  return res;
}

/** DRAFT → PENDING (administrativo; mismas validaciones del vendedor). */
export async function adminSendToReview(saleId: string) {
  return run("request_sale_review", saleId, { p_sale_id: saleId });
}

/** PENDING → SOLD (administrativo; contratos, datos y comisión del producto
 * se validan EXACTAMENTE igual que cuando lo hace el vendedor). */
export async function adminMarkSold(saleId: string) {
  return run("mark_sale_sold", saleId, { p_sale_id: saleId });
}

/** PENDING → DRAFT con motivo. */
export async function adminReturnToDraft(saleId: string, reason: string) {
  return run("return_sale_to_draft", saleId, { p_sale_id: saleId, p_reason: reason });
}

/** SOLD → PAID. Siempre explícito; exige cobro completo y exacto. */
export async function adminMarkPaid(saleId: string) {
  return run("admin_mark_sale_paid", saleId, { p_sale_id: saleId });
}

/** Revisión de cierre "pendiente a cobrar" (no cambia el estado). */
export async function adminConfirmClosing(saleId: string) {
  return run("admin_confirm_sale_closing", saleId, { p_sale_id: saleId });
}

/** Pago directo (tarjeta/Zelle/interno) → SETTLED. */
export async function adminSettleDirectPayment(saleId: string, allocationId: string) {
  return run("mark_payment_allocation_settled", saleId, { p_allocation_id: allocationId });
}

/**
 * Edición / corrección administrativa directa. El servidor recalcula
 * totales y comisión (snapshot) y audita cada campo.
 */
export async function adminUpdateSale(input: {
  saleId: string;
  payload: Record<string, unknown>;
  reason: string;
  adminCorrection: boolean;
  expectedUpdatedAt: string | null;
}) {
  return run("admin_update_cuba_sale", input.saleId, {
    p_sale_id: input.saleId,
    p_payload: input.payload,
    p_reason: input.reason,
    p_admin_correction: input.adminCorrection,
    p_expected_updated_at: input.expectedUpdatedAt,
  });
}
