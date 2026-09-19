import type { BonusProgress } from "@/lib/seller/types";
import {
  DashboardSection,
  EmptyState,
} from "@/components/seller/dashboard/dashboard-section";
import { cn, formatMoney } from "@/lib/utils";

function Metric({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "mt-0.5 text-sm font-semibold tabular-nums",
          accent ? "text-accent" : "text-foreground",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

export function BonusProgressCard({
  bonus,
  loading,
}: {
  bonus: BonusProgress;
  loading?: boolean;
}) {
  const pct =
    bonus.targetUnits > 0
      ? Math.min(100, Math.round((bonus.currentUnits / bonus.targetUnits) * 100))
      : 0;

  if (bonus.configured === false) {
    return (
      <DashboardSection
        title="Progreso a bonos"
        description="Camino al próximo tramo"
      >
        <EmptyState message="Bonos aún no configurados." />
      </DashboardSection>
    );
  }

  return (
    <DashboardSection
      title="Progreso a bonos"
      description="Camino al próximo tramo"
    >
      <div className={cn("space-y-4", loading && "animate-pulse opacity-60")}>
        <div>
          <div className="flex items-end justify-between">
            <span className="text-2xl font-semibold tabular-nums text-foreground">
              {bonus.currentUnits}
              <span className="text-muted-foreground"> / {bonus.targetUnits}</span>
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                unidades
              </span>
            </span>
            <span className="text-xs tabular-nums text-muted-foreground">
              {pct}%
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-muted">
            <div
              className="h-full rounded-full bg-accent transition-[width]"
              style={{ width: `${pct}%` }}
            />
          </div>
          {bonus.remainingUnits > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Faltan{" "}
              <span className="font-medium text-text-secondary">
                {bonus.remainingUnits}
              </span>{" "}
              unidades para el próximo bono.
            </p>
          )}
        </div>

        <dl className="grid grid-cols-2 gap-3">
          <Metric
            label="Bono de ventas actual"
            value={formatMoney(bonus.currentBonus)}
          />
          <Metric
            label="Próximo bono"
            value={formatMoney(bonus.nextBonus)}
            accent
          />
          <Metric
            label="Bono de marketing"
            value={formatMoney(bonus.marketingBonus)}
          />
          <Metric
            label="Unidades restantes"
            value={String(bonus.remainingUnits)}
          />
        </dl>

        <p className="rounded-lg bg-surface-muted px-3 py-2 text-[11px] text-muted-foreground">
          Marketing: {formatMoney(bonus.marketingBonusPerUnit)} por unidad · máx.{" "}
          {bonus.marketingBonusLimit} unidades
        </p>
      </div>
    </DashboardSection>
  );
}
