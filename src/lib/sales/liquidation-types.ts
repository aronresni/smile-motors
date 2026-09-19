/**
 * Formas compartidas entre Admin y Seller para el módulo de Liquidación
 * Semanal — viven en un lugar neutral (ni admin ni seller) para que
 * `src/lib/seller/liquidations.ts` no dependa de `src/lib/admin/*` (mismo
 * criterio ya aplicado a `sale_commission_summary` en `src/lib/sales/`).
 */

export interface LiquidationActivitySale {
  saleId: string;
  saleNumber: string | null;
  saleDate: string;
  buyerName: string | null;
  saleTotalCents: number | null;
  /** Solo presente en las ventas SOLD: comisión ya calculada, aún PENDING. */
  commissionPendingCents?: number;
}

export interface LiquidationCommissionItem {
  saleCommissionId?: string;
  saleId: string;
  saleNumber: string | null;
  productName: string;
  variantName: string | null;
  referencePriceCents: number;
  salePriceCents: number;
  priceDifferenceCents: number;
  baseCommissionCents: number;
  sellerDifferenceShareCents: number;
  finalCommissionCents: number;
  eligibleAt: string | null;
}

export interface LiquidationAdjustment {
  id?: string;
  type: "BONO" | "AJUSTE_POSITIVO" | "AJUSTE_NEGATIVO";
  amountCents: number;
  reason: string;
  createdByName?: string | null;
  createdAt: string;
}

export interface LiquidationActivity {
  pending: LiquidationActivitySale[];
  sold: LiquidationActivitySale[];
  paid: LiquidationActivitySale[];
}
