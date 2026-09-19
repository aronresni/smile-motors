import Link from "next/link";
import { ROUTES } from "@/lib/constants";
import type { LogisticsListItem } from "@/lib/admin/logistics";
import { formatDealerDateTime } from "@/lib/admin/dealer-time";
import { StatusBadge } from "@/components/ui/status-badge";

function StatusPill({ status }: { status: string }) {
  return <StatusBadge domain="logistics" status={status} />;
}

export function LogisticsListResults({ items }: { items: LogisticsListItem[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed px-6 py-14 text-center border-border">
        <p className="text-sm font-medium text-text-secondary">Sin unidades con estos filtros.</p>
      </div>
    );
  }

  return (
    <>
      {/* Escritorio */}
      <div className="hidden overflow-hidden rounded-xl border border-border lg:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground border-border bg-surface">
                <th className="px-3 py-2.5 font-medium">Venta</th>
                <th className="px-3 py-2.5 font-medium">Unidad / Producto</th>
                <th className="px-3 py-2.5 font-medium">Tracking</th>
                <th className="px-3 py-2.5 font-medium">Vendedor</th>
                <th className="px-3 py-2.5 font-medium">Destino</th>
                <th className="px-3 py-2.5 font-medium">Estado logístico</th>
                <th className="px-3 py-2.5 font-medium">Última actualización</th>
                <th className="px-3 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.saleUnitId} className="border-b last:border-0 border-border/70">
                  <td className="px-3 py-2.5 align-top">
                    <p className="font-medium">{item.saleNumber ?? "Sin número"}</p>
                    <p className="text-[11px] text-muted-foreground">{item.saleStatus}</p>
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    {item.productName}
                    {item.variantName && <span className="text-muted-foreground"> · {item.variantName}</span>}
                  </td>
                  <td className="px-3 py-2.5 align-top tabular-nums text-info">{item.trackingCode ?? "Pendiente"}</td>
                  <td className="px-3 py-2.5 align-top text-text-secondary">{item.sellerName}</td>
                  <td className="px-3 py-2.5 align-top text-muted-foreground">{item.destination ?? "—"}</td>
                  <td className="px-3 py-2.5 align-top"><StatusPill status={item.logisticsStatus} /></td>
                  <td className="px-3 py-2.5 align-top text-muted-foreground">{formatDealerDateTime(item.lastEventAt)}</td>
                  <td className="px-3 py-2.5 align-top text-right">
                    <Link href={`${ROUTES.adminVentas}/${item.saleId}`} className="inline-flex items-center rounded-lg border px-2.5 py-1 text-xs font-medium border-border hover:bg-surface-elevated">
                      Ver venta →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Móvil */}
      <ul className="space-y-2.5 lg:hidden">
        {items.map((item) => (
          <li key={item.saleUnitId} className="rounded-xl border p-3.5 border-border">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium">{item.saleNumber ?? "Sin número"}</p>
                <p className="text-xs text-muted-foreground">{item.productName}{item.variantName && ` · ${item.variantName}`}</p>
              </div>
              <StatusPill status={item.logisticsStatus} />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1.5 text-xs text-muted-foreground">
              <span>Tracking: {item.trackingCode ?? "Pendiente"}</span>
              <span>Vendedor: {item.sellerName}</span>
              <span>Destino: {item.destination ?? "—"}</span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">Actualizado: {formatDealerDateTime(item.lastEventAt)}</p>
            <Link href={`${ROUTES.adminVentas}/${item.saleId}`} className="mt-2 inline-flex items-center rounded-lg border px-2.5 py-1 text-xs font-medium border-border hover:bg-surface-elevated">
              Ver venta →
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
