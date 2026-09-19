import "server-only";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_BONUS_RULES } from "@/config/bonus";
import { formatCents } from "@/lib/money";
import {
  getSellerCommissionKpis,
  type SellerCommissionKpis,
} from "@/lib/seller/commissions";
import {
  bucketizeDailyActivity,
  liquidationWeekLabels,
  previousRange,
  type PeriodRange,
} from "@/lib/seller/period";
import type {
  KpiMetric,
  SellerDashboardData,
  TopModel,
} from "@/lib/seller/types";

/**
 * Datos del panel del vendedor a partir de ventas comerciales (SOLD + PAID).
 *
 * - `sales.status in ('SOLD', 'PAID')` — DRAFT/PENDING no cuentan como venta.
 * - Fecha de negocio: `sales.sale_date`.
 * - La agregación ocurre en la base (RPC `seller_dashboard_data`); aquí solo se
 *   mapea el resultado a la forma que consumen los componentes existentes.
 * - Aislamiento del vendedor: la RPC filtra por `auth.uid()` + RLS de `sales`.
 *   Nunca se pasa un `sellerId` del navegador.
 *
 * Comisiones: backend real (`seller_commission_kpis`) — pendiente/elegible
 * por vendedor propio, sin filtro de período (es un estado actual, no una
 * serie). Bonos / liquidación NO tienen backend autoritativo todavía: se
 * devuelven en estado "no disponible" y la UI lo muestra como tal.
 */

interface DashboardRpc {
  revenue: { currentCents: number; previousCents: number };
  units: { current: number; previous: number };
  unitsByType: { cuba: number; usa: number; local: number };
  telemetry: {
    date: string;
    cuba: number;
    usa: number;
    local: number;
  }[];
  topModels: { modelName: string; units: number }[];
}

function pctChange(
  current: number,
  previous: number,
): { deltaPct: number; trend: KpiMetric["trend"]; deltaLabel?: string } {
  if (previous <= 0) {
    if (current <= 0) return { deltaPct: 0, trend: "neutral" };
    return { deltaPct: 0, trend: "up", deltaLabel: "nuevo" };
  }
  const raw = ((current - previous) / previous) * 100;
  const deltaPct = Math.round(raw * 10) / 10;
  return {
    deltaPct,
    trend: deltaPct > 0 ? "up" : deltaPct < 0 ? "down" : "neutral",
  };
}

export async function getSellerDashboardData(
  range: PeriodRange,
): Promise<SellerDashboardData> {
  const prev = previousRange(range);
  const supabase = await createClient();

  // Las comisiones son un estado actual (pendiente/elegible), no un dato
  // filtrado por período — se piden en paralelo y nunca bloquean el panel.
  const [{ data, error }, commissionKpis] = await Promise.all([
    supabase.rpc("seller_dashboard_data", {
      p_start: range.startISO,
      p_end: range.endISO,
      p_prev_start: prev.startISO,
      p_prev_end: prev.endISO,
    }),
    getSellerCommissionKpis(),
  ]);

  if (error || !data) {
    // Nunca romper el panel: fallback vacío coherente.
    return buildEmptyDashboard(range, commissionKpis);
  }

  const rpc = data as unknown as DashboardRpc;
  return mapDashboard(range, rpc, commissionKpis);
}

/** Único slot "comisiones" del grid de KPIs: pendiente como valor principal,
 * elegible como texto secundario. Sin comparación de período (no aplica). */
function buildCommissionKpi(commissionKpis: SellerCommissionKpis): KpiMetric {
  return {
    id: "comisiones",
    label: "Mis comisiones",
    value: commissionKpis.pendingAmountCents,
    format: "money",
    previousValue: commissionKpis.eligibleAmountCents,
    deltaPct: 0,
    trend: "neutral",
    deltaLabel: `Elegible ${formatCents(commissionKpis.eligibleAmountCents)}`,
  };
}

function mapDashboard(
  range: PeriodRange,
  rpc: DashboardRpc,
  commissionKpis: SellerCommissionKpis,
): SellerDashboardData {
  const revenue = pctChange(
    rpc.revenue.currentCents,
    rpc.revenue.previousCents,
  );
  const units = pctChange(rpc.units.current, rpc.units.previous);

  const kpis: KpiMetric[] = [
    {
      id: "facturado",
      label: "Total facturado",
      value: rpc.revenue.currentCents,
      format: "money",
      previousValue: rpc.revenue.previousCents,
      deltaPct: revenue.deltaPct,
      trend: revenue.trend,
      deltaLabel: revenue.deltaLabel,
    },
    {
      id: "unidades",
      label: "Unidades vendidas",
      value: rpc.units.current,
      format: "units",
      previousValue: rpc.units.previous,
      deltaPct: units.deltaPct,
      trend: units.trend,
      deltaLabel: units.deltaLabel,
    },
    buildCommissionKpi(commissionKpis),
  ];

  const activity = bucketizeDailyActivity(range, rpc.telemetry ?? []);
  const totalUnits =
    rpc.unitsByType.cuba + rpc.unitsByType.usa + rpc.unitsByType.local;

  const topUnits = rpc.topModels.reduce((a, m) => a + m.units, 0);
  const topModels: TopModel[] = rpc.topModels.map((m) => ({
    name: m.modelName,
    units: m.units,
    share: rpc.units.current > 0 ? m.units / rpc.units.current : 0,
  }));
  const others = rpc.units.current - topUnits;
  if (others > 0) {
    topModels.push({
      name: "Otros",
      units: others,
      share: others / rpc.units.current,
      isOther: true,
    });
  }

  return {
    kpis,
    salesActivity: {
      buckets: activity.buckets,
      totalUnits: totalUnits || activity.totalUnits,
    },
    bonus: buildUnconfiguredBonus(),
    liquidations: liquidationWeekLabels(range).map((w) => ({
      weekStartISO: w.weekStartISO,
      label: w.label,
      commission: 0,
      bonus: 0,
      total: 0,
    })),
    topModels,
    generatedAt: new Date().toISOString(),
  };
}

function buildUnconfiguredBonus() {
  return {
    configured: false,
    currentUnits: 0,
    targetUnits: DEFAULT_BONUS_RULES.targetUnits,
    currentBonus: 0,
    nextBonus: DEFAULT_BONUS_RULES.nextBonus,
    remainingUnits: DEFAULT_BONUS_RULES.targetUnits,
    marketingBonus: 0,
    marketingBonusPerUnit: DEFAULT_BONUS_RULES.marketingBonusPerUnit,
    marketingBonusLimit: DEFAULT_BONUS_RULES.marketingBonusLimit,
  };
}

/** Fallback vacío (RPC de ventas no disponible / error). Las comisiones se
 * muestran igual si esa consulta (independiente) sí tuvo éxito. */
export function buildEmptyDashboard(
  range: PeriodRange,
  commissionKpis?: SellerCommissionKpis,
): SellerDashboardData {
  const { buckets } = bucketizeDailyActivity(range, []);
  return {
    kpis: [
      {
        id: "facturado",
        label: "Total facturado",
        value: 0,
        format: "money",
        previousValue: 0,
        deltaPct: 0,
        trend: "neutral",
      },
      {
        id: "unidades",
        label: "Unidades vendidas",
        value: 0,
        format: "units",
        previousValue: 0,
        deltaPct: 0,
        trend: "neutral",
      },
      buildCommissionKpi(
        commissionKpis ?? {
          pendingCount: 0,
          eligibleCount: 0,
          pendingAmountCents: 0,
          eligibleAmountCents: 0,
        },
      ),
    ],
    salesActivity: { buckets, totalUnits: 0 },
    bonus: buildUnconfiguredBonus(),
    liquidations: liquidationWeekLabels(range).map((w) => ({
      weekStartISO: w.weekStartISO,
      label: w.label,
      commission: 0,
      bonus: 0,
      total: 0,
    })),
    topModels: [],
    generatedAt: new Date().toISOString(),
  };
}
