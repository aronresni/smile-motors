import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { CommissionPreview } from "@/lib/sales/commission-preview";

/**
 * "Mis liquidaciones" — semana del vendedor (RPC `seller_weekly_liquidation`,
 * que fija el vendedor a `auth.uid()`; nunca se envía un id desde el navegador).
 *
 * Regla (migración 20260921120000, igual que la liquidación del admin):
 *  - La comisión congelada de una venta suma al "Total a liquidar" en la semana
 *    (lunes–domingo, hora del Este) en que la venta se marcó VENDIDA — no hace
 *    falta que el cliente termine de pagar (PAGADA). Una comisión solo puede
 *    estar en UNA liquidación.
 *  - PENDIENTES = "Próximas a confirmar": comisión ESTIMADA, nunca suma.
 */
export interface WeeklySaleRow {
  saleId: string;
  saleNumber: string | null;
  status: "DRAFT" | "PENDING" | "SOLD" | "PAID" | "CANCELLED" | string;
  operationType: string;
  businessDate: string;
  hasExplicitDate: boolean;
  soldAt: string | null;
  paidAt: string | null;
  buyerName: string | null;
  saleTotalCents: number;
  /** Parte de esta venta incluida en el total de ESTA semana. */
  countedThisWeekCents: number;
  commission: CommissionPreview;
}

export interface WeeklyLiquidation {
  seller: { id: string; fullName: string | null };
  weekStart: string;
  weekEnd: string;
  currentWeekStart: string;
  liquidation: {
    id: string;
    status: "DRAFT" | "APPROVED" | "PAID";
    totalCents: number;
    paidAt: string | null;
    approvedAt: string | null;
  } | null;
  summary: {
    confirmedCommissionsCents: number;
    unitsSold: number;
    bonusMarketingCents: number;
    bonusSalesCents: number;
    otherAdjustmentsCents: number;
    totalToPayCents: number;
    /** Liquidación aprobada/pagada: el total es definitivo. */
    isFinal: boolean;
    /** Próximas a confirmar (esta semana + anteriores). */
    upcomingCount: number;
    /** Comisión estimada potencial — informativa, NUNCA parte del total. */
    upcomingEstimatedCents: number;
    upcomingUnestimatedCount: number;
  };
  /** VENDIDAS/PAGADAS confirmadas en la semana. */
  confirmedSales: WeeklySaleRow[];
  /** PENDIENTES de la semana. */
  upcoming: WeeklySaleRow[];
  /** PENDIENTES de semanas anteriores (siguen hasta cambiar de estado). */
  upcomingPrevious: WeeklySaleRow[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `?week=yyyy-mm-dd` válido o `null` (semana actual del concesionario). */
export function parseWeekParam(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !ISO_DATE.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : value;
}

export async function getSellerWeeklyLiquidation(weekStart: string | null): Promise<WeeklyLiquidation | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_weekly_liquidation", weekStart ? { p_week_start: weekStart } : {});
  if (error || !data) return null;
  const res = data as unknown as { ok: boolean } & WeeklyLiquidation;
  if (!res.ok) return null;
  return {
    seller: res.seller,
    weekStart: res.weekStart,
    weekEnd: res.weekEnd,
    currentWeekStart: res.currentWeekStart,
    liquidation: res.liquidation ?? null,
    summary: res.summary,
    confirmedSales: res.confirmedSales ?? [],
    upcoming: res.upcoming ?? [],
    upcomingPrevious: res.upcomingPrevious ?? [],
  };
}
