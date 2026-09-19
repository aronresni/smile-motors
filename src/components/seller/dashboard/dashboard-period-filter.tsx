"use client";

import {
  PERIOD_OPTIONS,
  type Period,
  type PeriodKind,
  type PeriodRange,
} from "@/lib/seller/period";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/seller/icons";
import { cn } from "@/lib/utils";

interface DashboardPeriodFilterProps {
  period: Period;
  range: PeriodRange;
  pending?: boolean;
  onKindChange: (kind: PeriodKind) => void;
  onShift: (direction: -1 | 1) => void;
}

/**
 * Selector global de período. Estado propiedad de <SellerDashboard>: al cambiar
 * dispara la recarga de todas las analíticas.
 */
export function DashboardPeriodFilter({
  period,
  range,
  pending,
  onKindChange,
  onShift,
}: DashboardPeriodFilterProps) {
  return (
    <div className="flex flex-col gap-2.5 rounded-2xl border border-border bg-surface p-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div
        role="tablist"
        aria-label="Período de análisis"
        className="grid grid-cols-4 gap-1 rounded-xl bg-surface-muted p-1 sm:inline-flex"
      >
        {PERIOD_OPTIONS.map((opt) => {
          const active = opt.kind === period.kind;
          return (
            <button
              key={opt.kind}
              type="button"
              role="tab"
              aria-selected={active}
              title={opt.long}
              onClick={() => onKindChange(opt.kind)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                active
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {opt.short}
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-1.5 sm:justify-end">
        <button
          type="button"
          onClick={() => onShift(-1)}
          aria-label="Período anterior"
          className="grid h-8 w-8 place-items-center rounded-lg border border-border text-text-secondary transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <ChevronLeftIcon size={16} />
        </button>
        <span
          aria-live="polite"
          className={cn(
            "min-w-[8rem] text-center text-xs font-medium tabular-nums text-text-secondary transition-opacity",
            pending && "opacity-50",
          )}
        >
          {range.label}
        </span>
        <button
          type="button"
          onClick={() => onShift(1)}
          aria-label="Período siguiente"
          className="grid h-8 w-8 place-items-center rounded-lg border border-border text-text-secondary transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <ChevronRightIcon size={16} />
        </button>
      </div>
    </div>
  );
}
