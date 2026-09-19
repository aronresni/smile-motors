"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireZone } from "@/lib/auth/session";
import { ROUTES } from "@/lib/constants";

/**
 * Precio fijo de venta + comisión fija del PRODUCTO (sin VIN). TODAS pasan por
 * RPC `SECURITY DEFINER` que vuelven a exigir `is_admin()` server-side — mismo
 * patrón que el resto del Admin; un vendedor nunca puede modificarlos. Los
 * cambios afectan SOLO ventas futuras (las comisiones ya calculadas son
 * snapshots inmutables).
 */
export interface RpcResult {
  ok: boolean;
  code?: string;
  [key: string]: unknown;
}

/** Mismas reglas que la RPC: ambos obligatorios, enteros positivos y comisión < precio. */
function fixedValuesError(price: number, commission: number): string | null {
  if (!Number.isInteger(price) || price <= 0) return "FIXED_PRICE_INVALID";
  if (!Number.isInteger(commission) || commission <= 0) return "FIXED_COMMISSION_INVALID";
  if (commission >= price) return "FIXED_COMMISSION_TOO_HIGH";
  return null;
}

export async function updateProductCommissionDefaults(
  productId: string,
  defaultReferencePriceCents: number,
  defaultBaseCommissionCents: number,
): Promise<RpcResult> {
  await requireZone("admin");
  const invalid = fixedValuesError(defaultReferencePriceCents, defaultBaseCommissionCents);
  if (invalid) return { ok: false, code: invalid };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_update_product_commission_defaults", {
    p_product_id: productId,
    p_default_reference_price_cents: defaultReferencePriceCents,
    p_default_base_commission_cents: defaultBaseCommissionCents,
  });
  if (error || !data) return { ok: false, code: "UNEXPECTED" };
  const res = data as RpcResult;
  if (res.ok) {
    revalidatePath(`${ROUTES.adminProductos}/${productId}`);
    revalidatePath(ROUTES.adminProductos);
    revalidatePath(ROUTES.adminComisiones);
  }
  return res;
}
