"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ROUTES } from "@/lib/constants";

/**
 * Guardar los financiamientos / pagos de una venta.
 *
 * Va con la sesión del usuario: quién puede y qué puede lo decide
 * `set_sale_payment_allocations` en la base (administración en cualquier
 * venta, el vendedor en las suyas), con las barandillas del dinero que ya
 * entró. Nunca service_role.
 */

export interface AllocationInput {
  /** `null` = alta. */
  id: string | null;
  paymentMethodId: string;
  planId: string | null;
  inputMode: "GROSS" | "NET";
  amountCents: number;
  reference: string;
  notes: string;
  /** Anular el contrato ya emitido de esta asignación (solo administración). */
  voidContract?: boolean;
}

export interface BlockedAllocation {
  allocationId: string;
  code: "MONEY_ALREADY_IN" | "CONTRACT_EMITTED" | "ALLOCATION_NOT_IN_SALE" | string;
  lock?: "ACCREDITED" | "SETTLED" | "SIGNED" | "SENT" | string;
  removal?: boolean;
}

export interface SaveAllocationsResult {
  ok: boolean;
  code?: string;
  blocked?: BlockedAllocation[];
  added?: number;
  updated?: number;
  removed?: number;
  contractsVoided?: number;
  reconciliation?: {
    balanced: boolean;
    saleTotalCents: number;
    allocatedNetCents: number;
    collectedCents: number;
    differenceCents: number;
  };
}

export async function saveSalePaymentAllocations(input: {
  saleId: string;
  allocations: AllocationInput[];
  reason: string;
}): Promise<SaveAllocationsResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_sale_payment_allocations", {
    p_sale_id: input.saleId,
    p_allocations: input.allocations.map((a) => ({
      id: a.id,
      paymentMethodId: a.paymentMethodId,
      planId: a.planId,
      inputMode: a.inputMode,
      amountCents: Math.max(0, Math.round(a.amountCents)),
      reference: a.reference,
      notes: a.notes,
      voidContract: a.voidContract ?? false,
    })),
    p_reason: input.reason,
  });

  if (error) {
    if (process.env.NODE_ENV !== "production") console.error("[financing:save]", error);
    return { ok: false, code: "UNEXPECTED" };
  }

  const result = data as unknown as SaveAllocationsResult;
  if (result?.ok) {
    revalidatePath(`${ROUTES.adminVentas}/${input.saleId}`);
    revalidatePath(`${ROUTES.adminVentas}/${input.saleId}/editar`);
    revalidatePath(`${ROUTES.sellerVentas}/${input.saleId}`);
  }
  return result ?? { ok: false, code: "UNEXPECTED" };
}
