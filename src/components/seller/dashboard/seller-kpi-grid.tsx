import type { ReactNode } from "react";
import type { KpiId, KpiMetric } from "@/lib/seller/types";
import { SellerKpiCard } from "@/components/seller/dashboard/seller-kpi-card";
import { LayersIcon, TargetIcon, WalletIcon } from "@/components/seller/icons";

const ICON_BY_ID: Record<KpiId, ReactNode> = {
  facturado: <WalletIcon size={16} />,
  unidades: <LayersIcon size={16} />,
  comisiones: <TargetIcon size={16} />,
};

export function SellerKpiGrid({
  kpis,
  loading,
}: {
  kpis: KpiMetric[];
  loading?: boolean;
}) {
  return (
    <div className="grid grid-cols-3 gap-2.5 sm:gap-4">
      {kpis.map((metric) => (
        <SellerKpiCard
          key={metric.id}
          metric={metric}
          icon={ICON_BY_ID[metric.id]}
          loading={loading}
        />
      ))}
    </div>
  );
}
