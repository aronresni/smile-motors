import "server-only";
import { createClient } from "@/lib/supabase/server";
import type {
  LiquidationActivity,
  LiquidationActivitySale,
  LiquidationAdjustment,
  LiquidationCommissionItem,
} from "@/lib/sales/liquidation-types";

/**
 * Liquidación semanal — agrupa las comisiones (`sale_commissions`) de ventas confirmadas (VENDIDAS) en la semana
 * en un pago por vendedor/semana. Esta capa NUNCA calcula montos: solo lee
 * lo que las RPC ya agregaron. Ver `20260910300000_admin_liquidaciones.sql`.
 */
export type { LiquidationActivitySale, LiquidationAdjustment, LiquidationCommissionItem };

export type LiquidationStatus = "NONE" | "DRAFT" | "APPROVED" | "PAID";

export interface LiquidationWeekRow {
  sellerId: string;
  sellerName: string | null;
  liquidationId: string | null;
  status: LiquidationStatus;
  pendingSalesCount: number;
  soldSalesCount: number;
  paidSalesCount: number;
  eligibleCommissionsCount: number;
  subtotalCents: number;
  adjustmentsCents: number;
  totalCents: number;
}

export interface LiquidationWeekList {
  weekStart: string;
  weekEnd: string;
  /** true solo a partir del lunes siguiente al domingo de esta semana (server-side, nunca el reloj del navegador). */
  weekClosed: boolean;
  rows: LiquidationWeekRow[];
}

const EMPTY_WEEK = (weekStart: string): LiquidationWeekList => ({
  weekStart,
  weekEnd: weekStart,
  weekClosed: false,
  rows: [],
});

/**
 * `weekStart` es opcional a propósito: cuando el admin no navegó a una
 * semana explícita, NUNCA se calcula "hoy" en JS (sería la hora del proceso
 * Node, no la del negocio) — se deja que la RPC decida "hoy" en la zona
 * horaria del concesionario (`_dealer_timezone()`), la única fuente de
 * verdad server-side. Ver también `getCurrentLiquidationWeek()`.
 */
export async function getLiquidationWeekList(weekStart: string | null): Promise<LiquidationWeekList> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_liquidation_week_list", {
    p_week_start: weekStart ?? undefined,
  });
  const fallback = weekStart ?? new Date().toISOString().slice(0, 10);
  if (error || !data) return EMPTY_WEEK(fallback);
  const res = data as unknown as { ok: boolean } & Partial<LiquidationWeekList>;
  if (!res.ok) return EMPTY_WEEK(fallback);
  return {
    weekStart: res.weekStart ?? fallback,
    weekEnd: res.weekEnd ?? fallback,
    weekClosed: res.weekClosed ?? false,
    rows: res.rows ?? [],
  };
}

/** "Hoy" del concesionario — misma fuente de verdad que usa la RPC de lista
 * cuando no se pasa semana explícita; se expone aparte para que la
 * navegación (link "Hoy", resaltado de semana actual) nunca dependa del
 * reloj del navegador/servidor Node. */
export async function getCurrentLiquidationWeek(): Promise<{ weekStart: string; weekEnd: string } | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_liquidation_current_week");
  if (error || !data) return null;
  const res = data as unknown as { ok: boolean; weekStart?: string; weekEnd?: string };
  if (!res.ok || !res.weekStart || !res.weekEnd) return null;
  return { weekStart: res.weekStart, weekEnd: res.weekEnd };
}

export interface LiquidationDetail {
  id: string;
  sellerId: string;
  sellerName: string | null;
  weekStart: string;
  weekEnd: string;
  status: "DRAFT" | "APPROVED" | "PAID";
  subtotalCents: number;
  adjustmentsCents: number;
  totalCents: number;
  approvedAt: string | null;
  approvedByName: string | null;
  paidAt: string | null;
  paidByName: string | null;
  paymentReference: string | null;
  createdAt: string;
  /** true solo a partir del lunes siguiente al domingo de esta semana. */
  weekClosed: boolean;
  closesAt: string;
  activity: LiquidationActivity;
  commissionItems: LiquidationCommissionItem[];
  adjustments: LiquidationAdjustment[];
}

export async function getLiquidationDetail(liquidationId: string): Promise<LiquidationDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_liquidation_detail", { p_liquidation_id: liquidationId });
  if (error || !data) return null;
  const res = data as unknown as { ok: boolean; liquidation?: Record<string, unknown>; activity?: LiquidationDetail["activity"]; commissionItems?: LiquidationCommissionItem[]; adjustments?: LiquidationAdjustment[] };
  if (!res.ok || !res.liquidation) return null;
  const l = res.liquidation;
  return {
    id: l.id as string,
    sellerId: l.sellerId as string,
    sellerName: (l.sellerName as string) ?? null,
    weekStart: l.weekStart as string,
    weekEnd: l.weekEnd as string,
    status: l.status as LiquidationDetail["status"],
    subtotalCents: (l.subtotalCents as number) ?? 0,
    adjustmentsCents: (l.adjustmentsCents as number) ?? 0,
    totalCents: (l.totalCents as number) ?? 0,
    approvedAt: (l.approvedAt as string) ?? null,
    approvedByName: (l.approvedByName as string) ?? null,
    paidAt: (l.paidAt as string) ?? null,
    paidByName: (l.paidByName as string) ?? null,
    paymentReference: (l.paymentReference as string) ?? null,
    createdAt: l.createdAt as string,
    weekClosed: (l.weekClosed as boolean) ?? false,
    closesAt: l.closesAt as string,
    activity: res.activity ?? { pending: [], sold: [], paid: [] },
    commissionItems: res.commissionItems ?? [],
    adjustments: res.adjustments ?? [],
  };
}
