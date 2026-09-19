import Link from "next/link";
import { ROUTES } from "@/lib/constants";
import { formatCents } from "@/lib/money";
import type { CommissionListItem } from "@/lib/admin/commissions";
import { StatusBadge } from "@/components/ui/status-badge";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("es-DO", { dateStyle: "medium" }).format(d);
}
function signedCents(cents: number): string {
  const formatted = formatCents(Math.abs(cents));
  return cents > 0 ? `+${formatted}` : cents < 0 ? `-${formatted}` : formatted;
}

export function CommissionListResults({ items }: { items: CommissionListItem[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed px-6 py-14 text-center border-border">
        <p className="text-sm font-medium text-text-secondary">No hay comisiones con estos filtros.</p>
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
              <th className="px-3 py-2.5 font-medium">Unidad / Producto</th>
              <th className="px-3 py-2.5 font-medium">Precio fijo</th>
              <th className="px-3 py-2.5 font-medium">Precio vendido</th>
              <th className="px-3 py-2.5 font-medium">Adicional</th>
              <th className="px-3 py-2.5 font-medium">Comisión fija</th>
              <th className="px-3 py-2.5 font-medium">50% vendedor</th>
              <th className="px-3 py-2.5 font-medium">Comisión final</th>
              <th className="px-3 py-2.5 font-medium">Estado</th>
              <th className="px-3 py-2.5 font-medium">Fecha</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.commissionId} className="border-b last:border-0 border-border/70">
                <td className="px-3 py-2.5 align-top font-medium">
                  <Link href={`${ROUTES.adminVentas}/${item.saleId}`} className="hover:underline">
                    {item.saleNumber ?? "Sin número"}
                  </Link>
                </td>
                <td className="px-3 py-2.5 align-top text-text-secondary">
                  <Link href={`${ROUTES.adminVendedores}/${item.sellerId}`} className="hover:underline">
                    {item.sellerName}
                  </Link>
                </td>
                <td className="px-3 py-2.5 align-top">
                  {item.productName}
                  {item.variantName && <span className="text-muted-foreground"> · {item.variantName}</span>}
                  {item.trackingCode && <p className="text-[11px] text-muted-foreground">{item.trackingCode}</p>}
                </td>
                <td className="px-3 py-2.5 align-top tabular-nums">{formatCents(item.referencePriceCents)}</td>
                <td className="px-3 py-2.5 align-top tabular-nums">{formatCents(item.salePriceCents)}</td>
                <td className={`px-3 py-2.5 align-top tabular-nums ${item.priceDifferenceCents > 0 ? "text-success" : item.priceDifferenceCents < 0 ? "text-danger" : ""}`}>
                  {signedCents(item.priceDifferenceCents)}
                </td>
                <td className="px-3 py-2.5 align-top tabular-nums">{formatCents(item.baseCommissionCents)}</td>
                <td className={`px-3 py-2.5 align-top tabular-nums ${item.sellerDifferenceShareCents > 0 ? "text-success" : item.sellerDifferenceShareCents < 0 ? "text-danger" : ""}`}>
                  {signedCents(item.sellerDifferenceShareCents)}
                </td>
                <td className="px-3 py-2.5 align-top font-semibold tabular-nums">{formatCents(item.finalCommissionCents)}</td>
                <td className="px-3 py-2.5 align-top">
                  <StatusBadge domain="commission" status={item.status} size="xs" />
                </td>
                <td className="px-3 py-2.5 align-top text-muted-foreground">{formatDate(item.calculatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
