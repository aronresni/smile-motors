import { LOGISTICS_STATUS_LABEL, type SaleUnitLogisticsInfo } from "@/lib/sales/logistics-types";
import { formatDealerDateTime } from "@/lib/admin/dealer-time";
import { StatusBadge } from "@/components/ui/status-badge";

const EVENT_LABEL: Record<string, string> = {
  CREATED: "Inició seguimiento",
  TRANSITIONED: "Avanzó a",
  ON_HOLD: "Puso en espera",
  CORRECTED: "Corrigió a",
};

/** Estado + línea de tiempo de logística por unidad — compartido entre
 * Admin y Seller (solo lectura aquí; los controles de Admin viven aparte). */
export function LogisticsTimelineSection({ units }: { units: SaleUnitLogisticsInfo[] }) {
  if (units.length === 0) return null;

  return (
    <div className="space-y-4">
      {units.map((u) => (
        <div key={u.saleUnitId} className="rounded-lg p-3 bg-surface-muted">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">
              {u.productName}
              {u.variantName && <span className="text-muted-foreground"> · {u.variantName}</span>}
            </span>
            <StatusBadge domain="logistics" status={u.status} size="xs" />
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Tracking: {u.trackingCode ?? "Pendiente"}
          </p>
          {u.status === "ON_HOLD" && u.holdReason && (
            <p className="mt-1 rounded-md border px-2 py-1 text-[11px] border-danger/30 bg-danger/10 text-danger">
              Motivo de espera: {u.holdReason}
            </p>
          )}
          {u.events.length > 0 && (
            <ol className="mt-2 space-y-1 border-t pt-2 border-border">
              {u.events.map((e) => (
                <li key={e.id} className="text-[11px] text-muted-foreground">
                  <span className="tabular-nums text-muted-foreground">{formatDealerDateTime(e.occurredAt)}</span>
                  {" · "}
                  {EVENT_LABEL[e.eventType] ?? e.eventType} <strong>{LOGISTICS_STATUS_LABEL[e.toStatus]}</strong>
                  {e.actorName && ` · ${e.actorName}`}
                  {e.note && <span className="block text-muted-foreground">{e.note}</span>}
                </li>
              ))}
            </ol>
          )}
        </div>
      ))}
    </div>
  );
}
