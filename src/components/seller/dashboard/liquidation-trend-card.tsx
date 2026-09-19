import type { LiquidationWeek } from "@/lib/seller/types";
import {
  DashboardSection,
  EmptyState,
} from "@/components/seller/dashboard/dashboard-section";
import { cn, formatMoney } from "@/lib/utils";

export function LiquidationTrendCard({
  weeks,
  loading,
}: {
  weeks: LiquidationWeek[];
  loading?: boolean;
}) {
  const hasData = weeks.some((w) => w.total > 0);
  const last = weeks[weeks.length - 1];

  const W = 680;
  const H = 200;
  const padX = 12;
  const padTop = 12;
  const padBottom = 26;
  const chartW = W - padX * 2;
  const chartH = H - padTop - padBottom;
  const max = Math.max(1, ...weeks.map((w) => w.total));
  const stepX = chartW / Math.max(1, weeks.length - 1);

  const point = (w: LiquidationWeek, i: number): [number, number] => [
    padX + i * stepX,
    padTop + chartH - (w.total / max) * chartH,
  ];
  const pts = weeks.map(point);
  const line = pts
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");
  const area = `${line} L${(padX + (weeks.length - 1) * stepX).toFixed(1)} ${
    padTop + chartH
  } L${padX} ${padTop + chartH} Z`;

  return (
    <DashboardSection
      title="Tendencia de liquidación"
      description="Últimas 8 semanas · comisión + bono"
    >
      {!hasData && !loading ? (
        <EmptyState message="El módulo de liquidación aún no está disponible." tall />
      ) : (
        <div className={cn("w-full", loading && "animate-pulse opacity-60")}>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="h-40 w-full sm:h-52"
            role="img"
            aria-label="Total liquidado por semana en las últimas 8 semanas"
            preserveAspectRatio="none"
          >
            <defs>
              <linearGradient id="liq-fill" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor="var(--color-accent)"
                  stopOpacity="0.28"
                />
                <stop
                  offset="100%"
                  stopColor="var(--color-accent)"
                  stopOpacity="0"
                />
              </linearGradient>
            </defs>
            <line
              x1={padX}
              y1={padTop + chartH}
              x2={W - padX}
              y2={padTop + chartH}
              stroke="var(--color-border)"
              strokeWidth={1}
            />
            <path d={area} fill="url(#liq-fill)" />
            <path
              d={line}
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {pts.map(([x, y], i) => (
              <g key={weeks[i].weekStartISO}>
                <circle
                  cx={x}
                  cy={y}
                  r={2.5}
                  fill="var(--color-surface)"
                  stroke="var(--color-accent)"
                  strokeWidth={1.5}
                />
                <text
                  x={x}
                  y={H - 8}
                  textAnchor="middle"
                  fontSize={10}
                  fill="var(--color-muted-foreground)"
                >
                  {weeks[i].label}
                </text>
              </g>
            ))}
          </svg>

          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-muted-foreground">
            <span>
              Última semana:{" "}
              <b className="tabular-nums text-text-secondary">
                {formatMoney(last?.total ?? 0)}
              </b>
            </span>
            <span>
              Comisión:{" "}
              <b className="tabular-nums text-text-secondary">
                {formatMoney(last?.commission ?? 0)}
              </b>
            </span>
            <span>
              Bono:{" "}
              <b className="tabular-nums text-text-secondary">
                {formatMoney(last?.bonus ?? 0)}
              </b>
            </span>
          </div>
        </div>
      )}
    </DashboardSection>
  );
}
