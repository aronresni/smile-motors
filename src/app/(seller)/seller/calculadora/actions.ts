"use server";

import { revalidatePath } from "next/cache";
import { requireZone } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { ROUTES } from "@/lib/constants";
import { isPricingConfigured } from "@/lib/commission";
import { formatCents } from "@/lib/money";
import { todayISO } from "@/lib/seller/period";
import { getPaymentCatalog } from "@/lib/payments/catalog";
import { settleAllocation } from "@/lib/payments/allocation";
import type { Json } from "@/types/database.types";
import type { SaleDraftPayload } from "@/lib/sales/draft-transport";
import type { QuoteConversionInput } from "@/lib/sales/quote";

/**
 * CONVERTIR LA SIMULACIÓN EN UNA VENTA.
 *
 * Reglas que no se negocian:
 *  - La calculadora NO es una venta. Esto crea un BORRADOR y nada más: ni
 *    PENDIENTE, ni VENDIDA, ni contratos de financiación, ni pagos liquidados,
 *    ni comisión. El circuito de venta de siempre sigue mandando.
 *  - Del navegador solo llegan IDENTIFICADORES e IMPORTES ESCRITOS por el
 *    vendedor. El fee, el neto y el total se vuelven a calcular aquí con la
 *    configuración vigente (y otra vez dentro de `save_cuba_sale_draft`, que
 *    liquida en SQL). Un cliente manipulado no puede inventar un neto.
 *  - Si algo cambió desde que empezó la simulación (precio mínimo, producto o
 *    variante dados de baja, fee de la financiera), se avisa ANTES de crear el
 *    borrador y se muestra el cálculo actualizado.
 */

/** Tope defensivo: una simulación normal tiene 1-3 productos. */
const MAX_UNITS = 10;
const MAX_EXTRAS = 10;
const MAX_APPROVALS = 10;

export interface ConvertQuoteInput extends QuoteConversionInput {
  /**
   * Lo que el navegador CREÍA que daba la cuenta. Se usa SOLO para detectar
   * que la configuración cambió mientras la calculadora estaba abierta; nunca
   * se guarda ni sustituye al cálculo del servidor.
   */
  expected?: { totalCents: number; netCoveredCents: number };
  /** El vendedor ya vio los cambios y quiere continuar igual. */
  acknowledged?: boolean;
}

export interface QuoteRecalculation {
  totalCents: number;
  netCoveredCents: number;
  remainingCents: number;
  units: { productName: string; variantLabel: string | null; agreedPriceCents: number }[];
  approvals: {
    methodName: string;
    planLabel: string | null;
    grossCents: number;
    feeCents: number;
    netCents: number;
  }[];
  /** Diferencias legibles entre lo simulado y la configuración vigente. */
  changes: string[];
}

export type ConvertQuoteResult =
  | { ok: true; saleId: string }
  | { ok: false; code: "INVALID"; errors: string[] }
  | { ok: false; code: "CHANGED"; recalculation: QuoteRecalculation }
  | { ok: false; code: "FAILED"; errors: string[] };

const cents = (n: unknown): number =>
  typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;

export async function convertQuoteToDraft(
  input: ConvertQuoteInput,
): Promise<ConvertQuoteResult> {
  await requireZone("seller");
  const supabase = await createClient();

  const units = (input.units ?? []).slice(0, MAX_UNITS);
  const extras = (input.extras ?? []).slice(0, MAX_EXTRAS);
  const approvals = (input.approvals ?? []).slice(0, MAX_APPROVALS);

  if (units.length === 0) {
    return { ok: false, code: "INVALID", errors: ["Agrega al menos un producto."] };
  }

  const errors: string[] = [];
  const changes: string[] = [];

  /* ---------------------------------------------------- productos vigentes */
  const productIds = [...new Set(units.map((u) => u.productId))];
  const { data: productRows, error: productError } = await supabase
    .from("products")
    .select(
      "id, name, is_active, default_reference_price_cents, default_base_commission_cents",
    )
    .in("id", productIds);

  if (productError) {
    return { ok: false, code: "FAILED", errors: ["No pudimos leer el catálogo."] };
  }
  const productById = new Map((productRows ?? []).map((p) => [p.id, p]));

  const variantIds = [...new Set(units.map((u) => u.variantId).filter((v): v is string => Boolean(v)))];
  const { data: variantRows } = variantIds.length
    ? await supabase
        .from("product_variants")
        .select("id, product_id, color_name, is_active")
        .in("id", variantIds)
    : { data: [] };
  const variantById = new Map((variantRows ?? []).map((v) => [v.id, v]));

  const checkedUnits: QuoteRecalculation["units"] = [];
  const payloadUnits: SaleDraftPayload["units"] = [];

  for (const [i, u] of units.entries()) {
    const position = i + 1;
    const product = productById.get(u.productId);
    if (!product || !product.is_active) {
      errors.push(`El producto ${position} ya no está disponible en el catálogo.`);
      continue;
    }
    if (
      !isPricingConfigured(
        product.default_reference_price_cents,
        product.default_base_commission_cents,
      )
    ) {
      errors.push(
        `${product.name} no tiene precio de venta o comisión configurados. Un administrador debe completarlos.`,
      );
      continue;
    }

    let variantLabel: string | null = null;
    if (u.variantId) {
      const variant = variantById.get(u.variantId);
      if (!variant || variant.product_id !== product.id || !variant.is_active) {
        // No es un error fatal: se sigue sin color y se avisa.
        changes.push(`El color elegido para ${product.name} ya no está disponible.`);
      } else {
        variantLabel = variant.color_name;
      }
    }

    const minimum = product.default_reference_price_cents ?? 0;
    const agreed = cents(u.agreedPriceCents);
    if (agreed < minimum) {
      // El mensaje lleva el mínimo VIGENTE: si Administración lo subió
      // mientras la calculadora estaba abierta, el vendedor necesita saber
      // cuánto es ahora, no solo que está mal.
      errors.push(
        `El precio mínimo de ${product.name} es ${formatCents(minimum)}. Ajusta el precio pactado.`,
      );
      continue;
    }

    checkedUnits.push({
      productName: product.name,
      variantLabel,
      agreedPriceCents: agreed,
    });
    payloadUnits.push({
      productId: product.id,
      variantId: variantLabel ? u.variantId : null,
      agreedPriceCents: agreed,
    });
  }

  /* ------------------------------------------------------- métodos vigentes */
  const { byId } = await getPaymentCatalog();
  const checkedApprovals: QuoteRecalculation["approvals"] = [];
  const payloadAllocations: SaleDraftPayload["paymentAllocations"] = [];

  for (const [i, a] of approvals.entries()) {
    const method = byId[a.paymentMethodId];
    if (!method) {
      changes.push(`Un método de pago de la simulación ya no está activo.`);
      errors.push(`La aprobación ${i + 1} usa un método que ya no está disponible.`);
      continue;
    }
    const plan = a.planId ? (method.plans.find((p) => p.id === a.planId) ?? null) : null;
    if (a.planId && !plan) {
      changes.push(`El plazo elegido en ${method.name} ya no existe.`);
      errors.push(`Vuelve a elegir el plazo de ${method.name}.`);
      continue;
    }

    const gross = cents(a.grossCents);
    if (gross <= 0) {
      errors.push(`La aprobación de ${method.name} no tiene importe.`);
      continue;
    }

    // MISMO motor que la venta real (y espejo exacto del cálculo en SQL).
    const settlement = settleAllocation(
      { inputMode: "GROSS", amountCents: gross, planId: plan?.id ?? null },
      method,
    );
    if (settlement.error) {
      errors.push(`${method.name}: ${settlement.error}`);
      continue;
    }

    checkedApprovals.push({
      methodName: method.name,
      planLabel: plan?.label ?? null,
      grossCents: settlement.grossCents,
      feeCents: settlement.feeCents,
      netCents: settlement.netCents,
    });
    payloadAllocations.push({
      id: null,
      paymentMethodId: method.id,
      planId: plan?.id ?? null,
      inputMode: "GROSS",
      amountCents: gross,
      reference: "",
      notes: "",
    });
  }

  if (errors.length > 0) {
    return { ok: false, code: "INVALID", errors };
  }

  /* ------------------------------------------------------------- totales */
  const extrasClean = extras
    .map((e) => ({
      description: String(e.description ?? "").trim().slice(0, 120) || "Extra",
      amountCents: cents(e.amountCents),
    }))
    .filter((e) => e.amountCents > 0);

  const totalCents =
    checkedUnits.reduce((acc, u) => acc + u.agreedPriceCents, 0) +
    extrasClean.reduce((acc, e) => acc + e.amountCents, 0);
  const netCoveredCents = checkedApprovals.reduce((acc, a) => acc + a.netCents, 0);

  if (input.expected) {
    if (cents(input.expected.totalCents) !== totalCents) {
      changes.push("El total de la operación cambió con los precios vigentes.");
    }
    if (cents(input.expected.netCoveredCents) !== netCoveredCents) {
      changes.push("Lo que descuentan las financieras cambió: el neto ya no es el mismo.");
    }
  }

  const recalculation: QuoteRecalculation = {
    totalCents,
    netCoveredCents,
    remainingCents: totalCents - netCoveredCents,
    units: checkedUnits,
    approvals: checkedApprovals,
    changes: [...new Set(changes)],
  };

  if (recalculation.changes.length > 0 && !input.acknowledged) {
    return { ok: false, code: "CHANGED", recalculation };
  }

  /* --------------------------------------------- borrador (y nada más) */
  const { data: saleId, error: createError } = await supabase.rpc("create_sale_draft", {
    p_operation_type: "CUBA",
  });
  if (createError || !saleId) {
    return { ok: false, code: "FAILED", errors: ["No se pudo crear el borrador."] };
  }

  const payload: SaleDraftPayload = {
    saleDate: todayISO(),
    shareCommission: false,
    internalNotes: "",
    buyer: {
      firstName: "", lastName: "", dateOfBirth: "", documentNumber: "",
      documentExpiration: "", phone: "", email: "", addressLine1: "",
      addressLine2: "", city: "", state: "", postalCode: "",
    },
    coBuyer: null,
    units: payloadUnits,
    extras: extrasClean.map((e) => ({
      description: e.description,
      quantity: 1,
      unitAmountCents: e.amountCents,
    })),
    cubaRecipient: {
      fullName: "", identityNumber: "", deliveryAddress: "", municipality: "",
      province: "", phonePrimary: "", phoneSecondary: "",
    },
    delivery: { method: null, reference: "" },
    paymentAllocations: payloadAllocations,
  };

  const { error: saveError } = await supabase.rpc("save_cuba_sale_draft", {
    p_sale_id: saleId,
    p_payload: payload as unknown as Json,
  });
  if (saveError) {
    return {
      ok: false,
      code: "FAILED",
      errors: ["El borrador se creó pero no se pudo completar. Ábrelo desde Mis ventas."],
    };
  }

  revalidatePath(ROUTES.seller);
  revalidatePath(ROUTES.sellerVentas);
  return { ok: true, saleId };
}
