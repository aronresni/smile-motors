import { formatCents } from "@/lib/money";
import type { LiquidationActivity, LiquidationActivitySale } from "@/lib/sales/liquidation-types";

function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("es-DO", { dateStyle: "medium", timeZone: "UTC" }).format(d);
}

function SaleRow({ sale, note, noteTone }: { sale: LiquidationActivitySale; note: string; noteTone?: "warn" }) {
  return (
    <div className="rounded-lg p-3 text-sm bg-surface-muted">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">{sale.saleNumber ?? "Sin número"}</p>
        <span className="tabular-nums text-muted-foreground">{formatDate(sale.saleDate)}</span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{sale.buyerName ?? "Sin cliente"}</span>
        {sale.saleTotalCents != null && <span className="tabular-nums">{formatCents(sale.saleTotalCents)}</span>}
      </div>
      <p className={`mt-1.5 text-[11px] font-medium ${noteTone === "warn" ? "text-warning" : "text-muted-foreground"}`}>
        {note}
        {sale.commissionPendingCents != null && ` (${formatCents(sale.commissionPendingCents)})`}
      </p>
    </div>
  );
}

/**
 * "ACTIVIDAD DE LA SEMANA" — informativa, NUNCA suma al monto a pagar.
 * Compartida entre Admin y Seller (mismo shape, mismas reglas de negocio):
 * PENDING → "no incluida en esta liquidación"; SOLD → comisión ya calculada
 * pero todavía PENDING (no ELIGIBLE); PAID → ya contribuye en la sección de
 * comisiones a liquidar (no se repite el monto aquí).
 */
export function LiquidationActivitySection({ activity }: { activity: LiquidationActivity }) {
  const total = activity.pending.length + activity.sold.length + activity.paid.length;
  if (total === 0) {
    return <p className="text-sm text-muted-foreground">Sin ventas registradas esta semana.</p>;
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span>{activity.pending.length} PENDING</span>
        <span>{activity.sold.length} SOLD</span>
        <span>{activity.paid.length} PAID</span>
      </div>

      {activity.pending.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Pendientes de venta</p>
          {activity.pending.map((s) => (
            <SaleRow key={s.saleId} sale={s} note="Pendiente — no incluida en esta liquidación" noteTone="warn" />
          ))}
        </div>
      )}

      {activity.sold.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Vendidas — comisión pendiente</p>
          {activity.sold.map((s) => (
            <SaleRow key={s.saleId} sale={s} note="Vendida — comisión pendiente" noteTone="warn" />
          ))}
        </div>
      )}

      {activity.paid.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Pagadas</p>
          {activity.paid.map((s) => (
            <SaleRow key={s.saleId} sale={s} note="Pagada — ver comisiones a liquidar abajo" />
          ))}
        </div>
      )}
    </div>
  );
}
