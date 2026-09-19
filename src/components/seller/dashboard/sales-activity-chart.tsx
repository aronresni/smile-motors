import type { SalesActivitySeries, SalesRegion } from "@/lib/seller/types";
import type { PeriodKind } from "@/lib/seller/period";
import {
  DashboardSection,
  EmptyState,
} from "@/components/seller/dashboard/dashboard-section";
import { cn } from "@/lib/utils";

/**
 * Colores de categoría (data-viz, no tokens de UI):
 *  - Cuba  → acento de marca (ámbar)
 *  - USA   → un azul pizarra fijo
 *  - Local → texto secundario (gris del tema)
 */
export const REGIONS: { key: SalesRegion; label: string; color: string }[] = [
  { key: "cuba", label: "Cuba", color: "var(--color-accent)" },
  { key: "usa", label: "USA", color: "#6b8cc7" },
  { key: "local", label: "Local", color: "var(--color-text-secondary)" },
];

const KIND_HINT: Record<PeriodKind, string> = {
  day: "por franja horaria",
  week: "por día",
  month: "por semana",
  year: "por mes",
};

export function SalesActivityChart({
  series,
  periodKind,
  loading,
}: {
  series: SalesActivitySeries;
  periodKind: PeriodKind;
  loading?: boolean;
}) {
  const { buckets, totalUnits } = series;

  const W = 640;
  const H = 220;
  const padX = 10;
  const padTop = 12;
  const padBottom = 26;
  const chartW = W - padX * 2;
  const chartH = H - padTop - padBottom;
  const groupW = chartW / Math.max(1, buckets.length);
  const barW = Math.max(3, Math.min(11, (groupW - 8) / 3));
  const max = Math.max(
    1,
    ...buckets.flatMap((b) => [b.cuba, b.usa, b.local]),
  );

  return (
    <DashboardSection
      title="Actividad de ventas"
      description={`Unidades ${KIND_HINT[periodKind]} · Cuba · USA · Local`}
      action={<Legend />}
    >
      {totalUnits === 0 && !loading ? (
        <EmptyState message="Aún no hay ventas para este período." tall />
      ) : (
        <div className={cn("w-full", loading && "animate-pulse opacity-60")}>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="h-44 w-full sm:h-56"
            role="img"
            aria-label="Unidades vendidas por región a lo largo del período"
            preserveAspectRatio="none"
          >
            <line
              x1={padX}
              y1={padTop + chartH}
              x2={W - padX}
              y2={padTop + chartH}
              stroke="var(--color-border)"
              strokeWidth={1}
            />
            {buckets.map((bucket, i) => {
              const groupX = padX + i * groupW;
              const barsX = groupX + (groupW - barW * 3 - 4) / 2;
              return (
                <g key={`${bucket.label}-${i}`}>
                  {REGIONS.map((region, ri) => {
                    const value = bucket[region.key];
                    const h = (value / max) * chartH;
                    return (
                      <rect
                        key={region.key}
                        x={barsX + ri * (barW + 2)}
                        y={padTop + chartH - Math.max(h, value > 0 ? 2 : 0)}
                        width={barW}
                        height={Math.max(h, value > 0 ? 2 : 0)}
                        rx={2}
                        fill={region.color}
                      />
                    );
                  })}
                  <text
                    x={groupX + groupW / 2}
                    y={H - 8}
                    textAnchor="middle"
                    fontSize={10}
                    fill="var(--color-muted-foreground)"
                  >
                    {bucket.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </DashboardSection>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-3">
      {REGIONS.map((region) => (
        <span
          key={region.key}
          className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
        >
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: region.color }}
          />
          {region.label}
        </span>
      ))}
    </div>
  );
}
