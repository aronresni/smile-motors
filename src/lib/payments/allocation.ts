/**
 * Tipos y aritmética de liquidación de pagos. Módulo PURO (cliente + servidor):
 * sin `server-only`, sin red. La cobertura de la venta se mide en NETO.
 */
import {
  settle,
  feeConfigError,
  type FeeConfig,
  type FeeStrategy,
  type InputMode,
  type Settlement,
} from "@/lib/payments/fee-engine";

export type PaymentMethodType = "CARD" | "ZELLE" | "FINANCING" | "INTERNAL";

export interface PaymentPlanView {
  id: string;
  label: string;
  feeBps: number;
  termMonths: number | null;
  position: number;
}

export interface PaymentMethodView {
  id: string;
  legacyId: string;
  methodType: PaymentMethodType;
  name: string;
  subtext: string | null;
  iconKey: string | null;
  websiteUrl: string | null;
  websiteEnabled: boolean;
  onlyFlorida: boolean;
  requiresSignedContract: boolean;
  hasQueue: boolean;
  branchScope: string | null;
  feeStrategy: FeeStrategy;
  flatFeeBps: number | null;
  flatFeeCents: number | null;
  conditionalThresholdCents: number | null;
  conditionalBelowFeeCents: number | null;
  conditionalAboveFeeBps: number | null;
  zelleAccount: string | null;
  position: number;
  plans: PaymentPlanView[];
}

/** `FeeConfig` para el motor desde un método (+ fee del plan si aplica). */
export function buildFeeConfig(
  method: Pick<
    PaymentMethodView,
    | "feeStrategy"
    | "flatFeeBps"
    | "flatFeeCents"
    | "conditionalThresholdCents"
    | "conditionalBelowFeeCents"
    | "conditionalAboveFeeBps"
  >,
  planFeeBps: number | null,
): FeeConfig {
  return {
    strategy: method.feeStrategy,
    flatFeeBps: method.flatFeeBps,
    flatFeeCents: method.flatFeeCents,
    planFeeBps,
    conditionalThresholdCents: method.conditionalThresholdCents,
    conditionalBelowFeeCents: method.conditionalBelowFeeCents,
    conditionalAboveFeeBps: method.conditionalAboveFeeBps,
  };
}

/** Forma que consume el editor / la sección de liquidación en el formulario. */
export interface AllocationFormValue {
  key: string;
  id: string | null;
  paymentMethodId: string;
  planId: string | null;
  inputMode: InputMode;
  /** Importe que escribió el vendedor (bruto en modo GROSS, neto en modo NET). */
  amountCents: number;
  reference: string;
  notes: string;
  // desnormalizado para render + validación sin volver a mirar el catálogo:
  methodName: string;
  methodType: PaymentMethodType;
  feeStrategy: FeeStrategy;
  onlyFlorida: boolean;
  planLabel: string | null;
}

/** Liquidación de una allocation contra un método del catálogo (o null). */
export function settleAllocation(
  a: Pick<AllocationFormValue, "inputMode" | "amountCents" | "planId">,
  method: PaymentMethodView | undefined,
): Settlement & { error: string | null } {
  if (!method) {
    return { grossCents: 0, feeCents: 0, netCents: 0, error: "Método no disponible." };
  }
  const plan =
    a.planId != null ? method.plans.find((p) => p.id === a.planId) : undefined;
  const cfg = buildFeeConfig(method, plan ? plan.feeBps : null);
  const cfgErr = feeConfigError(cfg);
  if (cfgErr) {
    return { grossCents: 0, feeCents: 0, netCents: 0, error: cfgErr };
  }
  return { ...settle(a.inputMode, a.amountCents, cfg), error: null };
}

export type CoverageStatus =
  | "empty"
  | "underfunded"
  | "exact"
  | "overfunded";

export interface CoverageSummary {
  saleTotalCents: number;
  netCoveredCents: number;
  remainingCents: number; // saleTotal - netCovered (puede ser negativo => exceso)
  status: CoverageStatus;
  /** 0..100 (se capa a 100 en la barra). */
  pct: number;
  /** Alguna allocation con configuración inválida (plazo sin elegir, etc.). */
  hasInvalid: boolean;
}

export function summarizeCoverage(
  allocations: AllocationFormValue[],
  saleTotalCents: number,
  methodsById: Record<string, PaymentMethodView>,
): CoverageSummary {
  let net = 0;
  let hasInvalid = false;
  for (const a of allocations) {
    const s = settleAllocation(a, methodsById[a.paymentMethodId]);
    if (s.error) hasInvalid = true;
    net += s.netCents;
  }
  const remaining = saleTotalCents - net;
  const status: CoverageStatus =
    allocations.length === 0
      ? "empty"
      : remaining > 0
        ? "underfunded"
        : remaining < 0
          ? "overfunded"
          : "exact";
  const pct =
    saleTotalCents > 0
      ? Math.max(0, Math.round((net / saleTotalCents) * 100))
      : net > 0
        ? 100
        : 0;
  return {
    saleTotalCents,
    netCoveredCents: net,
    remainingCents: remaining,
    status,
    pct,
    hasInvalid,
  };
}

/** ¿Se puede continuar a revisión? Requiere cobertura EXACTA y sin inválidos. */
export function canProceedToReview(c: CoverageSummary): boolean {
  return (
    c.status === "exact" &&
    !c.hasInvalid &&
    c.saleTotalCents > 0 &&
    c.netCoveredCents === c.saleTotalCents
  );
}
