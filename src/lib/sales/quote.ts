/**
 * SIMULACIÓN DE VENTA (calculadora del vendedor). Módulo PURO — sin red, sin
 * `server-only` —: lo usan por igual la pantalla y la acción de servidor que
 * convierte la simulación en borrador.
 *
 * NO tiene aritmética propia de dinero: el fee de cada financiera sale del
 * motor único (`@/lib/payments/fee-engine`, vía `settleAllocation`) y la
 * cobertura de `summarizeCoverage`, exactamente igual que el formulario de
 * venta. Todo en CENTAVOS enteros.
 *
 * Una simulación NO es una venta: no crea contratos, ni pagos, ni comisión.
 */
import {
  settleAllocation,
  summarizeCoverage,
  type CoverageSummary,
  type PaymentMethodType,
  type PaymentMethodView,
} from "@/lib/payments/allocation";
import { sumCents } from "@/lib/money";

/** Producto elegido en la simulación. */
export interface QuoteLine {
  key: string;
  productId: string;
  variantId: string | null;
  /** Desnormalizado SOLO para pintar la tarjeta; el servidor lo vuelve a leer. */
  productName: string;
  variantLabel: string | null;
  listPriceCents: number | null;
  fixedPriceCents: number | null;
  fixedCommissionCents: number | null;
  imageUrl: string | null;
  /** Precio pactado con el cliente (lo escribe el vendedor). */
  agreedPriceCents: number;
}

/** Cargo adicional de la operación (accesorio, envío pactado…). */
export interface QuoteExtra {
  key: string;
  description: string;
  amountCents: number;
}

/** Aprobación / medio de pago SIMULADO. Nunca es un contrato de financiación. */
export interface QuoteApproval {
  key: string;
  paymentMethodId: string;
  planId: string | null;
  /** BRUTO aprobado por la financiera (o importe que paga el cliente). */
  grossCents: number;
  // desnormalizado para render (no autoritativo):
  methodName: string;
  methodType: PaymentMethodType;
  planLabel: string | null;
  termMonths: number | null;
  onlyFlorida: boolean;
}

export interface Quote {
  lines: QuoteLine[];
  extras: QuoteExtra[];
  approvals: QuoteApproval[];
  /** Estado del comprador si ya se conoce ("FL", "NJ"…). "" = todavía no. */
  buyerState: string;
}

export function emptyQuote(): Quote {
  return { lines: [], extras: [], approvals: [], buyerState: "" };
}

/* ------------------------------------------------------------------ totales */

export interface QuoteTotals {
  unitsCents: number;
  extrasCents: number;
  totalCents: number;
}

/**
 * TOTAL A CUBRIR. Misma definición que la venta real
 * (`computeSaleTotalCents`): Σ precio pactado + extras (+ entrega, que
 * todavía no tiene motor de precio y vale 0).
 */
export function quoteTotals(quote: Quote): QuoteTotals {
  const unitsCents = sumCents(quote.lines.map((l) => l.agreedPriceCents || 0));
  const extrasCents = sumCents(quote.extras.map((e) => e.amountCents || 0));
  return { unitsCents, extrasCents, totalCents: unitsCents + extrasCents };
}

/* -------------------------------------------------------------- aprobaciones */

export interface ApprovalSettlement {
  grossCents: number;
  feeCents: number;
  netCents: number;
  /** Configuración incompleta (p. ej. financiera a plazos sin plazo elegido). */
  error: string | null;
  /** Cuota mensual estimada, o `null` si el plan no define plazo. */
  monthlyCents: number | null;
  /** El método es "Solo Florida" y el comprador no está en Florida. */
  floridaBlocked: boolean;
}

/**
 * CUOTA MENSUAL ESTIMADA.
 *
 * El esquema (`payment_method_plans.term_months`) NO guarda interés del
 * cliente: `fee_bps` es lo que descuenta el proveedor al concesionario. Por eso
 * la estimación es la división simple del BRUTO aprobado entre el plazo, y solo
 * existe cuando el plan declara plazo. Sin plazo no se inventa ninguna fórmula.
 */
export function monthlyPaymentCents(
  grossCents: number,
  termMonths: number | null,
): number | null {
  if (!termMonths || termMonths <= 0) return null;
  const gross = Math.max(0, Math.trunc(grossCents));
  if (gross === 0) return null;
  return Math.round(gross / termMonths);
}

export function settleApproval(
  approval: QuoteApproval,
  method: PaymentMethodView | undefined,
  buyerState: string,
): ApprovalSettlement {
  const s = settleAllocation(
    { inputMode: "GROSS", amountCents: approval.grossCents, planId: approval.planId },
    method,
  );
  const plan = method?.plans.find((p) => p.id === approval.planId) ?? null;
  const termMonths = plan?.termMonths ?? approval.termMonths ?? null;
  const state = buyerState.trim().toUpperCase();
  return {
    grossCents: s.grossCents,
    feeCents: s.feeCents,
    netCents: s.netCents,
    error: s.error,
    monthlyCents: monthlyPaymentCents(approval.grossCents, termMonths),
    floridaBlocked: Boolean(method?.onlyFlorida) && state !== "" && state !== "FL",
  };
}

/** COBERTURA EN NETO — la misma función que usa la venta real. */
export function quoteCoverage(
  quote: Quote,
  methodsById: Record<string, PaymentMethodView>,
): CoverageSummary {
  return summarizeCoverage(
    quote.approvals.map((a) => ({
      paymentMethodId: a.paymentMethodId,
      planId: a.planId,
      inputMode: "GROSS" as const,
      amountCents: a.grossCents,
    })),
    quoteTotals(quote).totalCents,
    methodsById,
  );
}

/* --------------------------------------------------- transporte al servidor */

/**
 * Lo ÚNICO que viaja al servidor al convertir: identificadores e importes que
 * escribió el vendedor. Ni fee, ni neto, ni total — el servidor los recalcula
 * desde la configuración vigente y su resultado es el que manda.
 */
export interface QuoteConversionInput {
  units: { productId: string; variantId: string | null; agreedPriceCents: number }[];
  extras: { description: string; amountCents: number }[];
  approvals: { paymentMethodId: string; planId: string | null; grossCents: number }[];
}

export function toConversionInput(quote: Quote): QuoteConversionInput {
  return {
    units: quote.lines.map((l) => ({
      productId: l.productId,
      variantId: l.variantId,
      agreedPriceCents: Math.max(0, Math.trunc(l.agreedPriceCents || 0)),
    })),
    extras: quote.extras
      .filter((e) => e.description.trim() !== "" || e.amountCents > 0)
      .map((e) => ({
        description: e.description.trim() || "Extra",
        amountCents: Math.max(0, Math.trunc(e.amountCents || 0)),
      })),
    approvals: quote.approvals.map((a) => ({
      paymentMethodId: a.paymentMethodId,
      planId: a.planId,
      grossCents: Math.max(0, Math.trunc(a.grossCents || 0)),
    })),
  };
}

/* ---------------------------------------------------- persistencia de sesión */

/**
 * La simulación vive en `sessionStorage` mientras dura la pestaña. NO se guarda
 * nada del cliente final: solo productos, precios y montos.
 */
export const QUOTE_STORAGE_KEY = "smile.calculadora.v1";

const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** Lectura DEFENSIVA: cualquier cosa rara devuelve una simulación vacía. */
export function parseStoredQuote(raw: string | null): Quote {
  if (!raw) return emptyQuote();
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return emptyQuote();
  }
  if (!data || typeof data !== "object") return emptyQuote();
  const d = data as Record<string, unknown>;
  const lines = Array.isArray(d.lines) ? d.lines : [];
  const extras = Array.isArray(d.extras) ? d.extras : [];
  const approvals = Array.isArray(d.approvals) ? d.approvals : [];

  return {
    buyerState: isStr(d.buyerState) ? d.buyerState : "",
    lines: lines.flatMap((entry): QuoteLine[] => {
      const l = (entry ?? {}) as Record<string, unknown>;
      if (!isStr(l.productId) || !isStr(l.key)) return [];
      return [
        {
          key: l.key,
          productId: l.productId,
          variantId: isStr(l.variantId) ? l.variantId : null,
          productName: isStr(l.productName) ? l.productName : "",
          variantLabel: isStr(l.variantLabel) ? l.variantLabel : null,
          listPriceCents: isNum(l.listPriceCents) ? l.listPriceCents : null,
          fixedPriceCents: isNum(l.fixedPriceCents) ? l.fixedPriceCents : null,
          fixedCommissionCents: isNum(l.fixedCommissionCents)
            ? l.fixedCommissionCents
            : null,
          imageUrl: isStr(l.imageUrl) ? l.imageUrl : null,
          agreedPriceCents: isNum(l.agreedPriceCents)
            ? Math.max(0, Math.trunc(l.agreedPriceCents))
            : 0,
        },
      ];
    }),
    extras: extras.flatMap((entry): QuoteExtra[] => {
      const e = (entry ?? {}) as Record<string, unknown>;
      if (!isStr(e.key)) return [];
      return [
        {
          key: e.key,
          description: isStr(e.description) ? e.description : "",
          amountCents: isNum(e.amountCents)
            ? Math.max(0, Math.trunc(e.amountCents))
            : 0,
        },
      ];
    }),
    approvals: approvals.flatMap((entry): QuoteApproval[] => {
      const a = (entry ?? {}) as Record<string, unknown>;
      if (!isStr(a.key) || !isStr(a.paymentMethodId)) return [];
      return [
        {
          key: a.key,
          paymentMethodId: a.paymentMethodId,
          planId: isStr(a.planId) ? a.planId : null,
          grossCents: isNum(a.grossCents)
            ? Math.max(0, Math.trunc(a.grossCents))
            : 0,
          methodName: isStr(a.methodName) ? a.methodName : "",
          methodType: (isStr(a.methodType)
            ? a.methodType
            : "FINANCING") as PaymentMethodType,
          planLabel: isStr(a.planLabel) ? a.planLabel : null,
          termMonths: isNum(a.termMonths) ? a.termMonths : null,
          onlyFlorida: a.onlyFlorida === true,
        },
      ];
    }),
  };
}
