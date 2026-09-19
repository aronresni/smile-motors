import type { TopModel } from "@/lib/seller/types";
import {
  DashboardSection,
  EmptyState,
} from "@/components/seller/dashboard/dashboard-section";
import { cn } from "@/lib/utils";

/**
 * En vez de dona: ranking de barras horizontales (rank · modelo · unidades · %).
 * Más legible en móvil y con identidad distinta a la referencia.
 */
export function TopModelsCard({
  models,
  loading,
}: {
  models: TopModel[];
  loading?: boolean;
}) {
  const max = Math.max(1, ...models.map((m) => m.units));

  return (
    <DashboardSection
      title="Tus modelos más vendidos"
      description="Distribución de unidades por modelo"
    >
      {models.length === 0 && !loading ? (
        <EmptyState message="No hay ventas confirmadas en este período." />
      ) : (
        <ol className={cn("space-y-3", loading && "animate-pulse opacity-60")}>
          {models.map((model, i) => (
            <li key={model.name} className="flex items-center gap-3">
              <span className="w-4 shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm text-foreground">
                    {model.name}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {model.units} u · {Math.round(model.share * 100)}%
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-muted">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      model.isOther ? "bg-text-secondary/50" : "bg-accent",
                    )}
                    style={{ width: `${(model.units / max) * 100}%` }}
                  />
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </DashboardSection>
  );
}
