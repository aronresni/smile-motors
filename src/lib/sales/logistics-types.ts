/**
 * Formas y constantes de Logística compartidas entre Admin (server) y Seller
 * (client component `confirmed-sale-view.tsx`) — viven en un lugar neutral,
 * SIN `server-only`, para que un componente cliente pueda importarlas sin
 * arrastrar `@/lib/supabase/server` al bundle del navegador. Mismo criterio
 * ya aplicado a `liquidation-types.ts`.
 */

export type LogisticsStatus =
  | "PENDING_PREPARATION"
  | "READY"
  | "DISPATCHED"
  | "IN_TRANSIT"
  | "IN_CUBA"
  | "READY_FOR_DELIVERY"
  | "DELIVERED"
  | "ON_HOLD";

export const LOGISTICS_STATUS_LABEL: Record<LogisticsStatus, string> = {
  PENDING_PREPARATION: "Pendiente de preparar",
  READY: "Lista",
  DISPATCHED: "Despachada",
  IN_TRANSIT: "En tránsito",
  IN_CUBA: "En Cuba",
  READY_FOR_DELIVERY: "Lista para entrega",
  DELIVERED: "Entregada",
  ON_HOLD: "En espera",
};

/** Siguiente paso normal (forward-only) — sin entrada si no hay siguiente
 * (DELIVERED) o si el estado actual es ON_HOLD (requiere corrección explícita). */
export const LOGISTICS_NEXT_STATUS: Partial<Record<LogisticsStatus, LogisticsStatus>> = {
  PENDING_PREPARATION: "READY",
  READY: "DISPATCHED",
  DISPATCHED: "IN_TRANSIT",
  IN_TRANSIT: "IN_CUBA",
  IN_CUBA: "READY_FOR_DELIVERY",
  READY_FOR_DELIVERY: "DELIVERED",
};

export const LOGISTICS_STATUS_OPTIONS: { value: LogisticsStatus; label: string }[] = (
  Object.keys(LOGISTICS_STATUS_LABEL) as LogisticsStatus[]
).map((value) => ({ value, label: LOGISTICS_STATUS_LABEL[value] }));

export interface LogisticsEvent {
  id: string;
  eventType: "CREATED" | "TRANSITIONED" | "ON_HOLD" | "CORRECTED";
  fromStatus: LogisticsStatus | null;
  toStatus: LogisticsStatus;
  actorName: string | null;
  occurredAt: string;
  note: string | null;
}

export interface SaleUnitLogisticsInfo {
  saleUnitId: string;
  productName: string;
  variantName: string | null;
  trackingCode: string | null;
  status: LogisticsStatus;
  holdReason: string | null;
  shipmentReference: string | null;
  containerReference: string | null;
  carrierReference: string | null;
  estimatedDeliveryDate: string | null;
  deliveredAt: string | null;
  lastEventAt: string;
  events: LogisticsEvent[];
}
