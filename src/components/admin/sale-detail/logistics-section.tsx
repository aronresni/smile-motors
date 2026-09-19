import { LOGISTICS_STATUS_LABEL } from "@/lib/admin/logistics";
import type { SaleUnitLogisticsInfo } from "@/lib/admin/logistics";
import { formatDealerDateTime } from "@/lib/admin/dealer-time";
import { LogisticsAdminControls } from "@/components/admin/sale-detail/logistics-admin-controls";
import { StatusBadge } from "@/components/ui/status-badge";

/** "LOGÍSTICA / ENVÍO" — Admin puede abrir/actualizar desde aquí. Ciclo
 * INDEPENDIENTE del estado comercial de la venta (nunca lo lee ni lo cambia). */
export function LogisticsSection({ saleId, units }: { saleId: string; units: SaleUnitLogisticsInfo[] }) {
  if (units.length === 0) {
    return <p className="text-xs text-muted-foreground">Sin unidades para esta venta.</p>;
  }

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
            Tracking: {u.trackingCode ?? "Pendiente"} · Última actualización: {formatDealerDateTime(u.lastEventAt)}
          </p>
          {u.status === "ON_HOLD" && u.holdReason && (
            <p className="mt-1 rounded-md border px-2 py-1 text-[11px] border-danger/30 bg-danger/10 text-danger">
              Motivo de espera: {u.holdReason}
            </p>
          )}

          <LogisticsAdminControls saleId={saleId} unit={u} />

          {u.events.length > 0 && (
            <details className="mt-2 border-t pt-2 border-border">
              <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground">Ver historial ({u.events.length})</summary>
              <ol className="mt-1.5 space-y-1">
                {u.events.map((e) => (
                  <li key={e.id} className="text-[11px] text-muted-foreground">
                    <span className="tabular-nums text-muted-foreground">{formatDealerDateTime(e.occurredAt)}</span>
                    {" · "}
                    <strong>{LOGISTICS_STATUS_LABEL[e.toStatus]}</strong>
                    {e.actorName && ` · ${e.actorName}`}
                    {e.note && <span className="block text-muted-foreground">{e.note}</span>}
                  </li>
                ))}
              </ol>
            </details>
          )}
        </div>
      ))}
    </div>
  );
}
