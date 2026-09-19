/**
 * Comisión de una venta tal como se MUESTRA (RPC `_sale_commission_preview`):
 *  - FROZEN      → congelada al marcar VENDIDA (la única que cuenta).
 *  - ESTIMATED   → BORRADOR/PENDIENTE: precio de la venta + configuración
 *                  vigente del producto. Nunca se guarda ni se suma.
 *  - UNAVAILABLE → BORRADOR/PENDIENTE sin estimación posible ("Sin calcular").
 *  - NONE        → CANCELADA, o VENDIDA/PAGADA sin comisión registrada.
 */
export type CommissionPreviewKind = "FROZEN" | "ESTIMATED" | "UNAVAILABLE" | "NONE";

export interface CommissionPreviewUnit {
  saleUnitId: string;
  productName: string;
  variant: string | null;
  priceCents: number;
  kind: CommissionPreviewKind;
  cents: number | null;
  reason: string | null;
  /** Estado de COBRO de la venta (PENDING = por cobrar, ELIGIBLE = cobrada). No condiciona la liquidación. */
  commissionStatus: "PENDING" | "ELIGIBLE" | null;
  eligibleAt: string | null;
  liquidationId: string | null;
}

export interface CommissionPreview {
  kind: CommissionPreviewKind;
  totalCents: number | null;
  reason: string | null;
  units: CommissionPreviewUnit[];
}

const REASON_TEXT: Record<string, string> = {
  CONFIG_MISSING: "Producto sin precio fijo o comisión fija",
  BELOW_FIXED_PRICE: "Precio por debajo del precio fijo",
  NO_PRODUCT: "Unidad sin producto",
  NO_UNITS: "Sin unidades",
  NOT_RECORDED: "Vendida antes del registro de comisiones",
  CANCELLED: "Venta cancelada",
};

export function commissionReasonText(reason: string | null): string | null {
  return reason ? (REASON_TEXT[reason] ?? null) : null;
}

export function emptyCommissionPreview(): CommissionPreview {
  return { kind: "UNAVAILABLE", totalCents: null, reason: null, units: [] };
}
