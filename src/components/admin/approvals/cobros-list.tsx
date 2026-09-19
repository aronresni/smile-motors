import Link from "next/link";
import { ROUTES } from "@/lib/constants";
import { formatCents } from "@/lib/money";
import type { CollectionInboxItem } from "@/lib/admin/approvals";

function ageSinceSold(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const days = Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24));
  return days <= 0 ? "Hoy" : `${days} día${days === 1 ? "" : "s"} desde SOLD`;
}

export function CobrosList({ items }: { items: CollectionInboxItem[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed px-6 py-14 text-center border-border">
        <p className="text-sm font-medium text-text-secondary">No hay ventas pendientes de cobro.</p>
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground border-border bg-surface">
              <th className="px-3 py-2.5 font-medium">Venta</th>
              <th className="px-3 py-2.5 font-medium">Vendedor</th>
              <th className="px-3 py-2.5 font-medium">Cliente</th>
              <th className="px-3 py-2.5 font-medium">Fecha SOLD</th>
              <th className="px-3 py-2.5 font-medium">Total</th>
              <th className="px-3 py-2.5 font-medium">Cobrado</th>
              <th className="px-3 py-2.5 font-medium">Pendiente</th>
              <th className="px-3 py-2.5 font-medium">Antigüedad</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.saleId} className="border-b last:border-0 border-border/70">
                <td className="px-3 py-2.5 align-top font-medium">{item.saleNumber ?? "Sin número"}</td>
                <td className="px-3 py-2.5 align-top text-text-secondary">{item.sellerName}</td>
                <td className="px-3 py-2.5 align-top text-text-secondary">{item.buyerName}</td>
                <td className="px-3 py-2.5 align-top text-muted-foreground">
                  {item.soldAt ? new Intl.DateTimeFormat("es-DO", { dateStyle: "medium" }).format(new Date(item.soldAt)) : "—"}
                </td>
                <td className="px-3 py-2.5 align-top tabular-nums">{formatCents(item.saleTotalCents)}</td>
                <td className="px-3 py-2.5 align-top tabular-nums text-success">{formatCents(item.collectedCents)}</td>
                <td className="px-3 py-2.5 align-top tabular-nums font-medium text-warning">{formatCents(item.outstandingCents)}</td>
                <td className="px-3 py-2.5 align-top text-muted-foreground">{ageSinceSold(item.soldAt)}</td>
                <td className="px-3 py-2.5 text-right align-top">
                  <Link
                    href={`${ROUTES.adminVentas}/${item.saleId}`}
                    className="inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium border-border hover:bg-surface-elevated"
                  >
                    Ver venta
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
