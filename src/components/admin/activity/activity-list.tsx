import Link from "next/link";
import type { ActivityItem } from "@/lib/admin/activity";
import { formatDealerDate, formatDealerTime } from "@/lib/admin/dealer-time";

const CATEGORY_CLASS: Record<string, string> = {
  VENTAS: "border-info/30 bg-info/10 text-info",
  CONTRATOS: "border-purple-300 bg-purple-50 text-purple-700 dark:border-purple-400/30 dark:bg-purple-400/10 dark:text-purple-300",
  COBROS: "border-success/30 bg-success/10 text-success",
  PRODUCTOS: "border-warning/30 bg-warning/10 text-warning",
  COMISIONES: "border-pink-300 bg-pink-50 text-pink-700 dark:border-pink-400/30 dark:bg-pink-400/10 dark:text-pink-300",
  LIQUIDACIONES: "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-400/30 dark:bg-indigo-400/10 dark:text-indigo-300",
  VENDEDORES: "border-border bg-surface-muted text-text-secondary",
  LOGISTICA: "border-warning/30 bg-warning/10 text-warning",
};

/** Feed cronológico — un renglón por evento, agrupado visualmente por día.
 * Todo el rango viene ya ordenado/paginado por el servidor. */
export function ActivityList({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed px-6 py-14 text-center border-border">
        <p className="text-sm font-medium text-text-secondary">Sin actividad con estos filtros.</p>
      </div>
    );
  }

  const days = items.map((item) => formatDealerDate(item.occurredAt));

  return (
    <div className="space-y-1">
      {items.map((item, i) => {
        const day = days[i];
        const showDayHeader = i === 0 || days[i - 1] !== day;
        return (
          <div key={`${item.entityType}-${item.entityId}-${item.eventType}-${item.occurredAt}-${i}`}>
            {showDayHeader && (
              <p className="mb-1.5 mt-4 first:mt-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {day}
              </p>
            )}
            <Link
              href={item.destinationUrl}
              className="flex items-start gap-3 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-surface-elevated"
            >
              <span className="mt-0.5 w-14 shrink-0 tabular-nums text-xs text-muted-foreground">
                {formatDealerTime(item.occurredAt)}
              </span>
              <span
                className={`mt-0.5 inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${CATEGORY_CLASS[item.category] ?? ""}`}
              >
                {item.category}
              </span>
              <span className="min-w-0 flex-1">
                <span className="font-medium text-muted-foreground">{item.actorName ?? "Sistema"}</span>{" "}
                <span className="text-foreground">{item.title}</span>
                {item.description && (
                  <span className="block text-xs text-muted-foreground">{item.description}</span>
                )}
              </span>
            </Link>
          </div>
        );
      })}
    </div>
  );
}
