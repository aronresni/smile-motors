import type { ReactNode } from "react";
import type { KpiMetric } from "@/lib/seller/types";
import { cn, formatSignedPct } from "@/lib/utils";
import { formatCents } from "@/lib/money";
import { DashIcon, TrendDownIcon, TrendUpIcon } from "@/components/seller/icons";

const trendColor: Record<KpiMetric["trend"], string> = {
  up: "text-success",
  down: "text-danger",
  neutral: "text-muted-foreground",
};

function mainValue(metric: KpiMetric): string {
  // Las métricas monetarias del panel llegan en CENTAVOS (enteros).
  return metric.format === "money"
    ? formatCents(metric.value)
    : String(metric.value);
}

export function SellerKpiCard({
  metric,
  icon,
  loading,
}: {
  metric: KpiMetric;
  icon?: ReactNode;
  loading?: boolean;
}) {
  const TrendIcon =
    metric.trend === "up"
      ? TrendUpIcon
      : metric.trend === "down"
        ? TrendDownIcon
        : DashIcon;

  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-surface p-3.5 sm:p-4",
        loading && "animate-pulse",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground sm:text-[11px]">
          {metric.label}
        </span>
        {icon && <span className="hidden text-text-secondary sm:block">{icon}</span>}
      </div>

      {metric.unavailable ? (
        <>
          <p className="mt-2 text-sm font-semibold text-muted-foreground sm:text-base">
            Pendiente de cálculo
          </p>
          <p className="mt-1.5 text-[10px] text-muted-foreground sm:text-[11px]">
            El motor de comisiones aún no está disponible.
          </p>
        </>
      ) : (
        <>
          <p className="mt-2 text-lg font-semibold tabular-nums tracking-tight text-foreground sm:text-2xl">
            {mainValue(metric)}
            {metric.format === "units" && (
              <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                unidades
              </span>
            )}
          </p>

          <p
            className={cn(
              "mt-1.5 flex flex-wrap items-center gap-x-1 text-[10px] font-medium sm:text-[11px]",
              trendColor[metric.trend],
            )}
          >
            <TrendIcon size={12} />
            <span className="tabular-nums">
              {metric.deltaLabel ?? formatSignedPct(metric.deltaPct)}
            </span>
            <span className="hidden text-muted-foreground sm:inline">
              vs período anterior
            </span>
          </p>
        </>
      )}
    </div>
  );
}
