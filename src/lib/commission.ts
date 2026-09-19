/**
 * Precio fijo de venta + comisión fija — cálculo PURO en centavos (enteros),
 * idéntico al de `mark_sale_sold`. Solo para mostrar (simulador, estimación
 * antes de enviar la venta, desglose); el servidor es la única fuente de
 * verdad y congela el resultado al marcar la venta VENDIDA.
 *
 *   ganancia adicional = precio de venta − precio fijo        (nunca < 0)
 *   parte del vendedor = mitad de la ganancia, redondeada HACIA ABAJO al centavo
 *   parte de la tienda = ganancia − parte del vendedor        (centavo restante)
 *   comisión final     = comisión fija + parte del vendedor
 */

export interface CommissionBreakdown {
  fixedPriceCents: number;
  fixedCommissionCents: number;
  salePriceCents: number;
  extraCents: number;
  sellerExtraCents: number;
  storeExtraCents: number;
  finalCommissionCents: number;
  /** El precio simulado es inferior al precio fijo: esa venta no se permite. */
  belowFixedPrice: boolean;
}

/** Un producto está configurado solo si ambos valores existen y son > 0. */
export function isPricingConfigured(
  fixedPriceCents: number | null | undefined,
  fixedCommissionCents: number | null | undefined,
): fixedPriceCents is number {
  return (fixedPriceCents ?? 0) > 0 && (fixedCommissionCents ?? 0) > 0;
}

export function computeCommission(
  fixedPriceCents: number,
  fixedCommissionCents: number,
  salePriceCents: number,
): CommissionBreakdown {
  const fixed = Math.round(fixedPriceCents);
  const base = Math.round(fixedCommissionCents);
  const sale = Math.round(salePriceCents);
  const extra = Math.max(0, sale - fixed);
  // Enteros: `Math.floor(extra / 2)` es exacto (no hay error de punto flotante).
  const sellerExtra = Math.floor(extra / 2);
  return {
    fixedPriceCents: fixed,
    fixedCommissionCents: base,
    salePriceCents: sale,
    extraCents: extra,
    sellerExtraCents: sellerExtra,
    storeExtraCents: extra - sellerExtra,
    finalCommissionCents: base + sellerExtra,
    belowFixedPrice: sale < fixed,
  };
}
