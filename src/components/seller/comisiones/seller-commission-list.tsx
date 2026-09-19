import Link from "next/link";
import { ROUTES } from "@/lib/constants";
import { formatCents } from "@/lib/money";
import type { SellerCommissionListItem } from "@/lib/seller/commissions";
import { ChevronRightIcon } from "@/components/seller/icons";
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
function saleHref(saleId: string): string {
  return `${ROUTES.sellerVentas}/${saleId}`;
}

/** Tabla en escritorio. */
function DesktopTable({ items }: { items: SellerCommissionListItem[] }) {
  return (
    <div className="hidden overflow-hidden rounded-2xl border border-border bg-surface lg:block">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-3 font-medium">Venta / Fecha</th>
            <th className="px-4 py-3 font-medium">Producto</th>
            <th className="px-4 py-3 text-right font-medium">Precio fijo</th>
            <th className="px-4 py-3 text-right font-medium">Vendido</th>
            <th className="px-4 py-3 text-right font-medium">Adicional</th>
            <th className="px-4 py-3 text-right font-medium">Comisión fija</th>
            <th className="px-4 py-3 text-right font-medium">Tu 50%</th>
            <th className="px-4 py-3 text-right font-medium">Total</th>
            <th className="px-4 py-3 font-medium">Estado</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.commissionId}
              className="group border-b border-border/60 last:border-0 transition-colors hover:bg-surface-muted/60"
            >
              <td className="px-4 py-3 align-top">
                <Link
                  href={saleHref(item.saleId)}
                  prefetch={false}
                  className="font-semibold text-foreground focus-visible:outline-none focus-visible:underline"
                >
                  {item.saleNumber ?? "Sin número"}
                </Link>
                <div className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                  {formatDate(item.soldAt)}
                </div>
              </td>
              <td className="px-4 py-3 align-top text-text-secondary">
                {item.productName}
                {item.variantName && <span className="text-muted-foreground"> · {item.variantName}</span>}
              </td>
              <td className="px-4 py-3 text-right align-top tabular-nums text-text-secondary">
                {formatCents(item.referencePriceCents)}
              </td>
              <td className="px-4 py-3 text-right align-top tabular-nums text-text-secondary">
                {formatCents(item.salePriceCents)}
              </td>
              <td
                className={`px-4 py-3 text-right align-top tabular-nums ${item.priceDifferenceCents > 0 ? "text-success" : item.priceDifferenceCents < 0 ? "text-danger" : "text-text-secondary"}`}
              >
                {signedCents(item.priceDifferenceCents)}
              </td>
              <td className="px-4 py-3 text-right align-top tabular-nums text-text-secondary">
                {formatCents(item.baseCommissionCents)}
              </td>
              <td
                className={`px-4 py-3 text-right align-top tabular-nums ${item.sellerDifferenceShareCents > 0 ? "text-success" : item.sellerDifferenceShareCents < 0 ? "text-danger" : "text-text-secondary"}`}
              >
                {signedCents(item.sellerDifferenceShareCents)}
              </td>
              <td className="px-4 py-3 text-right align-top font-semibold tabular-nums text-foreground">
                {formatCents(item.finalCommissionCents)}
              </td>
              <td className="px-4 py-3 align-top">
                <StatusBadge domain="commission" status={item.status} size="xs" />
              </td>
              <td className="px-4 py-3 align-top text-right">
                <Link
                  href={saleHref(item.saleId)}
                  prefetch={false}
                  className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-text-secondary transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  Ver
                  <ChevronRightIcon size={14} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Tarjetas en móvil/tablet. */
function MobileCards({ items }: { items: SellerCommissionListItem[] }) {
  return (
    <ul className="space-y-2.5 lg:hidden">
      {items.map((item) => (
        <li key={item.commissionId}>
          <Link
            href={saleHref(item.saleId)}
            prefetch={false}
            className="relative block rounded-2xl border border-border bg-surface p-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:bg-surface-muted/70"
          >
            <div className="flex items-start justify-between gap-3">
              <span className="font-semibold tabular-nums text-foreground">
                {item.saleNumber ?? "Sin número"}
              </span>
              <StatusBadge domain="commission" status={item.status} size="xs" />
            </div>

            <div className="mt-2">
              <p className="font-medium text-text-secondary">
                {item.productName}
                {item.variantName && <span className="text-muted-foreground"> · {item.variantName}</span>}
              </p>
              <p className="text-xs text-muted-foreground">{formatDate(item.soldAt)}</p>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-1.5 text-xs text-muted-foreground">
              <span>
                Precio fijo:{" "}
                <strong className="text-text-secondary">{formatCents(item.referencePriceCents)}</strong>
              </span>
              <span>
                Vendido:{" "}
                <strong className="text-text-secondary">{formatCents(item.salePriceCents)}</strong>
              </span>
              <span>
                Adicional:{" "}
                <strong className={item.priceDifferenceCents > 0 ? "text-success" : item.priceDifferenceCents < 0 ? "text-danger" : "text-text-secondary"}>
                  {signedCents(item.priceDifferenceCents)}
                </strong>
              </span>
              <span>
                Tu 50%:{" "}
                <strong className={item.sellerDifferenceShareCents > 0 ? "text-success" : item.sellerDifferenceShareCents < 0 ? "text-danger" : "text-text-secondary"}>
                  {signedCents(item.sellerDifferenceShareCents)}
                </strong>
              </span>
            </div>

            <div className="mt-3 flex items-end justify-between gap-3">
              <span className="text-lg font-semibold tabular-nums text-foreground">
                {formatCents(item.finalCommissionCents)}
              </span>
              <ChevronRightIcon size={14} className="text-muted-foreground" />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function SellerCommissionList({ items }: { items: SellerCommissionListItem[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border px-6 py-14 text-center">
        <p className="text-sm font-medium text-text-secondary">
          Todavía no tienes comisiones calculadas.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Se calculan automáticamente cuando una venta pasa a Vendida.
        </p>
      </div>
    );
  }
  return (
    <div>
      <DesktopTable items={items} />
      <MobileCards items={items} />
    </div>
  );
}
