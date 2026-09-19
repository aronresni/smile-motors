"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import {
  resolveRange,
  shiftPeriod,
  withKind,
  type Period,
  type PeriodKind,
} from "@/lib/seller/period";
import type { SellerDashboardData } from "@/lib/seller/types";
import type { SellerIdentity } from "@/lib/seller/identity";
import { loadDashboard } from "@/app/(seller)/seller/actions";
import { DashboardIntro } from "@/components/seller/dashboard/dashboard-intro";
import { SellerQuickAccess } from "@/components/seller/dashboard/seller-quick-access";
import { DashboardPeriodFilter } from "@/components/seller/dashboard/dashboard-period-filter";
import { SellerKpiGrid } from "@/components/seller/dashboard/seller-kpi-grid";
import { SalesActivityChart } from "@/components/seller/dashboard/sales-activity-chart";
import { BonusProgressCard } from "@/components/seller/dashboard/bonus-progress-card";
import { TopModelsCard } from "@/components/seller/dashboard/top-models-card";
import { LiquidationTrendCard } from "@/components/seller/dashboard/liquidation-trend-card";

interface SellerDashboardProps {
  seller: SellerIdentity;
  initialPeriod: Period;
  initialData: SellerDashboardData;
}

/**
 * Orquesta el estado de período y compone el panel.
 * URLs reales + layout persistente: navegar entre secciones NO desmonta este
 * árbol; el período se recalcula server-side vía `loadDashboard`.
 */
export function SellerDashboard({
  seller,
  initialPeriod,
  initialData,
}: SellerDashboardProps) {
  const [period, setPeriod] = useState<Period>(initialPeriod);
  const [data, setData] = useState<SellerDashboardData>(initialData);
  const [isPending, startTransition] = useTransition();

  const range = useMemo(() => resolveRange(period), [period]);

  const applyPeriod = useCallback((next: Period) => {
    setPeriod(next);
    startTransition(async () => {
      try {
        setData(await loadDashboard(next));
      } catch {
        // Se conservan los datos previos; el server action revalida sesión/rol.
      }
    });
  }, []);

  return (
    <div className="space-y-4 sm:space-y-5">
      <DashboardIntro seller={seller} />

      <SellerQuickAccess />

      <DashboardPeriodFilter
        period={period}
        range={range}
        pending={isPending}
        onKindChange={(kind: PeriodKind) => applyPeriod(withKind(period, kind))}
        onShift={(direction) => applyPeriod(shiftPeriod(period, direction))}
      />

      <SellerKpiGrid kpis={data.kpis} loading={isPending} />

      <SalesActivityChart
        series={data.salesActivity}
        periodKind={period.kind}
        loading={isPending}
      />

      <div className="grid gap-4 sm:gap-5 lg:grid-cols-2">
        <BonusProgressCard bonus={data.bonus} loading={isPending} />
        <TopModelsCard models={data.topModels} loading={isPending} />
      </div>

      <LiquidationTrendCard weeks={data.liquidations} loading={isPending} />
    </div>
  );
}
