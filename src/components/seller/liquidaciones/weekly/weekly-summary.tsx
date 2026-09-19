import Link from "next/link";
import { ROUTES } from "@/lib/constants";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { WeeklyLiquidation } from "@/lib/seller/weekly-liquidation";
import { addDaysISO, formatWeekRange } from "@/lib/seller/week-dates";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/ui/icons";
import { StatusBadge } from "@/components/ui/status-badge";

/** Encabezado semanal: semana, rango, flechas y vendedor. */
export function WeeklyHeader({ data }: { data: WeeklyLiquidation }) {
  const prev = addDaysISO(data.weekStart, -7);
  const next = addDaysISO(data.weekStart, 7);
  const isCurrent = data.weekStart === data.currentWeekStart;
  const canGoNext = data.weekStart < data.currentWeekStart;
  const arrow =
    "inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-border-strong bg-surface text-foreground transition-colors hover:border-brand/50 hover:bg-surface-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 sm:min-h-10 sm:min-w-10";
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">Mis liquidaciones</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          {isCurrent ? "Semana actual" : "Semana seleccionada"}
        </h1>
        <p className="mt-1 text-sm tabular-nums text-text-secondary">{formatWeekRange(data.weekStart, data.weekEnd)}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Vendedor: <span className="font-medium text-foreground">{data.seller.fullName ?? "—"}</span>
        </p>
      </div>
      <nav aria-label="Cambiar de semana" className="flex items-center gap-2">
        <Link href={`${ROUTES.sellerLiquidaciones}?week=${prev}`} aria-label="Semana anterior" className={arrow}>
          <ChevronLeftIcon size={18} />
        </Link>
        {!isCurrent && (
          <Link
            href={ROUTES.sellerLiquidaciones}
            className="inline-flex min-h-11 items-center rounded-xl border border-border-strong px-3 text-xs font-medium text-text-secondary hover:text-foreground sm:min-h-10"
          >
            Ir a la semana actual
          </Link>
        )}
        {canGoNext ? (
          <Link href={`${ROUTES.sellerLiquidaciones}?week=${next}`} aria-label="Semana siguiente" className={arrow}>
            <ChevronRightIcon size={18} />
          </Link>
        ) : (
          <span aria-disabled="true" aria-label="Semana siguiente (no disponible)" className={cn(arrow, "cursor-not-allowed opacity-40 hover:border-border-strong hover:bg-surface")}>
            <ChevronRightIcon size={18} />
          </span>
        )}
      </nav>
    </div>
  );
}

function Metric({ label, value, tone, hint }: { label: string; value: string; tone?: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={cn("mt-1 text-lg font-semibold tabular-nums", tone ?? "text-foreground")}>{value}</dd>
      {hint && <dd className="text-[11px] text-muted-foreground">{hint}</dd>}
    </div>
  );
}

/**
 * Tarjeta de resumen: SOLO valores confirmados (ventas VENDIDAS/PAGADAS
 * confirmadas en la semana + bonos/ajustes de la liquidación aprobada). Las
 * "próximas a confirmar" se resumen APARTE y nunca se mezclan con el total.
 */
export function WeeklySummaryCard({ data }: { data: WeeklyLiquidation }) {
  const s = data.summary;
  return (
    <section aria-label="Resumen de la semana" className="space-y-3">
      <div className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <Metric label="Comisiones" value={formatCents(s.confirmedCommissionsCents)} tone="text-success" hint="De ventas VENDIDAS" />
          <Metric label="Unidades vendidas" value={String(s.unitsSold)} />
          <Metric label="Bono de marketing" value={formatCents(s.bonusMarketingCents)} />
          <Metric label="Bono de ventas" value={formatCents(s.bonusSalesCents)} />
          <div className="col-span-2 min-w-0 rounded-xl border border-success/30 bg-success-soft px-3.5 py-3 sm:col-span-1">
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-success">Total a liquidar</dt>
            <dd className="mt-1 text-2xl font-bold tabular-nums text-success">{formatCents(s.totalToPayCents)}</dd>
            <dd className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              {data.liquidation && s.isFinal ? (
                <StatusBadge domain="liquidation" status={data.liquidation.status} size="xs" />
              ) : (
                "Pendiente de aprobación del admin"
              )}
            </dd>
          </div>
        </dl>
        <div className="mt-4 space-y-1.5 border-t border-border pt-3 text-xs text-muted-foreground">
          {s.otherAdjustmentsCents !== 0 && (
            <p>
              Ajustes de la liquidación:{" "}
              <strong className="tabular-nums text-foreground">
                {s.otherAdjustmentsCents > 0 ? "+" : "−"}
                {formatCents(Math.abs(s.otherAdjustmentsCents))}
              </strong>{" "}
              (incluidos en el total).
            </p>
          )}
          <p>
            Cada venta suma su comisión congelada en la semana en que se marca VENDIDA, aunque el cliente todavía no haya
            terminado de pagar. Los bonos se suman cuando el admin aprueba la liquidación. Una comisión nunca entra en dos
            liquidaciones.
          </p>
        </div>
      </div>

      <div
        role="group"
        aria-label="Próximas a confirmar"
        className="flex flex-col gap-1 rounded-2xl border border-warning/35 bg-warning-soft px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
      >
        <p className="font-semibold text-warning">
          Próximas a confirmar: {s.upcomingCount} {s.upcomingCount === 1 ? "venta" : "ventas"}
        </p>
        <p className="text-text-secondary">
          Comisión estimada potencial:{" "}
          <strong className="tabular-nums text-warning">{formatCents(s.upcomingEstimatedCents)}</strong>
          {s.upcomingUnestimatedCount > 0 && (
            <span className="text-muted-foreground"> · {s.upcomingUnestimatedCount} sin calcular</span>
          )}
          <span className="block text-[11px] text-muted-foreground sm:inline"> — informativa, no forma parte del total</span>
        </p>
      </div>
    </section>
  );
}
