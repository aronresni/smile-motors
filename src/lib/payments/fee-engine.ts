/**
 * Motor de comisiones de método de pago / financiera. ÚNICA fuente de verdad
 * del cálculo de fees en el frontend. El backend (`payment_fee_settlement` en
 * SQL) implementa exactamente la misma aritmética entera.
 *
 * Conceptos:
 *   BRUTO (gross)  = importe procesado/financiado por el proveedor
 *   FEE            = coste que descuenta el proveedor
 *   NETO (net)     = importe realmente acreditado a la venta  (= gross - fee)
 *
 * Todo en CENTAVOS enteros. Sin coma flotante para dinero: los porcentajes se
 * expresan en BASIS POINTS (350 = 3.5 %, 1000 = 10 %, 1895 = 18.95 %).
 */

export type FeeStrategy =
  | "NONE"
  | "FLAT_RATE"
  | "FIXED_AMOUNT"
  | "FIXED_PLUS_PERCENT"
  | "INSTALLMENTS"
  | "CONDITIONAL";

export const FEE_STRATEGIES: FeeStrategy[] = [
  "NONE",
  "FLAT_RATE",
  "FIXED_AMOUNT",
  "FIXED_PLUS_PERCENT",
  "INSTALLMENTS",
  "CONDITIONAL",
];

export type InputMode = "GROSS" | "NET";

export interface FeeConfig {
  strategy: FeeStrategy;
  /** FLAT_RATE, FIXED_PLUS_PERCENT: porcentaje en basis points. */
  flatFeeBps?: number | null;
  /** FIXED_AMOUNT, FIXED_PLUS_PERCENT: cargo fijo en centavos. */
  flatFeeCents?: number | null;
  /** INSTALLMENTS: fee del plan seleccionado en basis points. */
  planFeeBps?: number | null;
  /** CONDITIONAL: umbral (centavos), cargo fijo por debajo, % por encima. */
  conditionalThresholdCents?: number | null;
  conditionalBelowFeeCents?: number | null;
  conditionalAboveFeeBps?: number | null;
}

export interface Settlement {
  grossCents: number;
  feeCents: number;
  netCents: number;
}

const MAX_MONEY = 1_000_000_000_00; // 1e11 centavos ($1,000,000,000): tope de seguridad

const int = (n: number | null | undefined): number =>
  Number.isFinite(n as number) ? Math.trunc(n as number) : 0;

/** Fee porcentual redondeado (half-up), idéntico a `round()` de Postgres. */
export function bpsFee(amountCents: number, bps: number): number {
  const a = Math.max(0, int(amountCents));
  const b = Math.max(0, int(bps));
  return Math.round((a * b) / 10000);
}

/** ¿Falta algún dato para calcular el fee con esta estrategia? */
export function feeConfigError(cfg: FeeConfig): string | null {
  switch (cfg.strategy) {
    case "NONE":
      return null;
    case "FLAT_RATE":
      return cfg.flatFeeBps == null ? "Falta el porcentaje del método." : null;
    case "FIXED_AMOUNT":
      return cfg.flatFeeCents == null ? "Falta el cargo fijo del método." : null;
    case "FIXED_PLUS_PERCENT":
      return cfg.flatFeeCents == null || cfg.flatFeeBps == null
        ? "Falta el cargo fijo o el porcentaje del método."
        : null;
    case "INSTALLMENTS":
      return cfg.planFeeBps == null
        ? "Selecciona el plazo de la financiera."
        : null;
    case "CONDITIONAL":
      return cfg.conditionalThresholdCents == null ||
        cfg.conditionalBelowFeeCents == null ||
        cfg.conditionalAboveFeeBps == null
        ? "Falta la configuración condicional del método."
        : null;
  }
}

/** FEE dado el BRUTO. Determinista, entero, fee acotado a [0, gross]. */
export function feeFromGross(grossCents: number, cfg: FeeConfig): number {
  const g = Math.max(0, int(grossCents));
  let fee = 0;
  switch (cfg.strategy) {
    case "NONE":
      fee = 0;
      break;
    case "FLAT_RATE":
      fee = bpsFee(g, int(cfg.flatFeeBps));
      break;
    case "FIXED_AMOUNT":
      fee = int(cfg.flatFeeCents);
      break;
    case "FIXED_PLUS_PERCENT":
      fee = int(cfg.flatFeeCents) + bpsFee(g, int(cfg.flatFeeBps));
      break;
    case "INSTALLMENTS":
      fee = bpsFee(g, int(cfg.planFeeBps));
      break;
    case "CONDITIONAL": {
      const threshold = int(cfg.conditionalThresholdCents);
      fee =
        g < threshold
          ? int(cfg.conditionalBelowFeeCents)
          : bpsFee(g, int(cfg.conditionalAboveFeeBps));
      break;
    }
  }
  return Math.max(0, Math.min(fee, g));
}

/** Liquidación desde el BRUTO. */
export function settleFromGross(grossCents: number, cfg: FeeConfig): Settlement {
  const grossC = Math.max(0, int(grossCents));
  const feeCents = feeFromGross(grossC, cfg);
  return { grossCents: grossC, feeCents, netCents: grossC - feeCents };
}

const netFromGross = (g: number, cfg: FeeConfig): number => g - feeFromGross(g, cfg);

/**
 * Menor BRUTO tal que `net(gross) >= netTarget` (búsqueda binaria entera).
 * Válida cuando `net(gross)` es monótona no decreciente respecto a gross.
 */
function solveGross(netTarget: number, cfg: FeeConfig): number {
  const target = Math.max(0, int(netTarget));
  if (target === 0) return 0;
  let lo = target;
  let hi = target;
  let guard = 0;
  while (netFromGross(hi, cfg) < target && hi < MAX_MONEY && guard < 80) {
    hi = hi * 2 + 1;
    guard += 1;
  }
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (netFromGross(mid, cfg) >= target) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** Liquidación desde el NETO deseado (cálculo inverso, entero y determinista). */
export function settleFromNet(netTargetCents: number, cfg: FeeConfig): Settlement {
  const target = Math.max(0, int(netTargetCents));
  if (target === 0) return { grossCents: 0, feeCents: 0, netCents: 0 };

  switch (cfg.strategy) {
    case "NONE":
      return { grossCents: target, feeCents: 0, netCents: target };

    case "FIXED_AMOUNT": {
      const gross = target + Math.max(0, int(cfg.flatFeeCents));
      return settleFromGross(gross, cfg);
    }

    case "CONDITIONAL": {
      const threshold = int(cfg.conditionalThresholdCents);
      const below = Math.max(0, int(cfg.conditionalBelowFeeCents));
      // Rama por debajo del umbral: gross = net + cargo fijo.
      const grossBelow = target + below;
      if (grossBelow < threshold) return settleFromGross(grossBelow, cfg);
      // Rama porcentual (>= umbral).
      const gross = Math.max(solveGross(target, cfg), threshold);
      return settleFromGross(gross, cfg);
    }

    // FLAT_RATE / FIXED_PLUS_PERCENT / INSTALLMENTS
    default: {
      const gross = solveGross(target, cfg);
      return settleFromGross(gross, cfg);
    }
  }
}

/** Punto de entrada único: liquida según el modo de entrada. */
export function settle(
  mode: InputMode,
  amountCents: number,
  cfg: FeeConfig,
): Settlement {
  return mode === "NET"
    ? settleFromNet(amountCents, cfg)
    : settleFromGross(amountCents, cfg);
}

/* ------------------------------------------------------------------ formato */

/** basis points -> texto legible: 350 -> "3.5%", 1000 -> "10%". */
export function formatBps(bps: number | null | undefined): string {
  const b = int(bps);
  const pct = b / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2).replace(/\.?0+$/, "")}%`;
}

/** Resumen corto del fee de un método, para tarjetas del selector. */
export function feeStrategySummary(cfg: FeeConfig): string {
  switch (cfg.strategy) {
    case "NONE":
      return "Sin comisión";
    case "FLAT_RATE":
      return `Comisión ${formatBps(cfg.flatFeeBps)}`;
    case "FIXED_AMOUNT":
      return `Comisión fija`;
    case "FIXED_PLUS_PERCENT":
      return `Comisión fija + ${formatBps(cfg.flatFeeBps)}`;
    case "INSTALLMENTS":
      return `Comisión según plazo`;
    case "CONDITIONAL":
      return `Comisión condicional`;
  }
}
