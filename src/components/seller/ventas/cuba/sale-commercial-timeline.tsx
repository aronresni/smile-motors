import type { StatusHistoryEntry } from "@/lib/sales/confirmed-sale";

const STAGES: { toStatus: string; label: string }[] = [
  { toStatus: "PENDING", label: "Revisión solicitada" },
  { toStatus: "SOLD", label: "Venta cerrada por el vendedor" },
  { toStatus: "PAID", label: "Pago confirmado por administración" },
];

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("es-DO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

/** Última entrada del historial hacia cada estado (evita duplicar reintentos). */
function latestByStage(history: StatusHistoryEntry[]) {
  return STAGES.map((stage) => {
    const matches = history.filter((h) => h.toStatus === stage.toStatus);
    return { ...stage, entry: matches[matches.length - 1] ?? null };
  });
}

/**
 * Línea de tiempo operativa basada en EVENTOS REALES (`sale_status_history`).
 * Solo estas 3 etapas por ahora; logística/post-venta se añaden más adelante.
 */
export function SaleCommercialTimeline({
  history,
}: {
  history: StatusHistoryEntry[];
}) {
  const stages = latestByStage(history);
  if (!stages.some((s) => s.entry)) return null;

  return (
    <ol className="space-y-3">
      {stages.map((s) => (
        <li key={s.toStatus} className="flex items-start gap-3">
          <span
            className={
              s.entry
                ? "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-success bg-success/15 text-[11px] font-bold text-success"
                : "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-border text-[11px] text-muted-foreground"
            }
          >
            {s.entry ? "✓" : "○"}
          </span>
          <div className="min-w-0">
            <p
              className={
                s.entry
                  ? "text-sm font-medium text-foreground"
                  : "text-sm text-muted-foreground"
              }
            >
              {s.label}
            </p>
            {s.entry && (
              <p className="text-[11px] text-muted-foreground">
                {formatWhen(s.entry.changedAt)}
                {s.entry.changedByName ? ` · ${s.entry.changedByName}` : ""}
              </p>
            )}
            {s.entry?.reason && (
              <p className="mt-0.5 text-[11px] italic text-text-secondary">
                “{s.entry.reason}”
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
