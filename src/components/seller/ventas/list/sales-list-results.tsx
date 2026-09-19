import Link from "next/link";
import { cn } from "@/lib/utils";
import { formatCents } from "@/lib/money";
import { ROUTES } from "@/lib/constants";
import { ChevronRightIcon } from "@/components/seller/icons";
import { EyeIcon } from "@/components/ui/icons";
import { CommissionAmount } from "@/components/commission/commission-amount";
import type { SellerSaleListFinancing, SellerSaleListItem } from "@/lib/seller/sales-list";
import { SaleStatusBadge } from "@/components/seller/ventas/list/sale-status-badge";
import {
  formatSaleListDate,
  paidDateLabel,
  settlementNote,
  trackingCodes,
} from "@/components/seller/ventas/list/format";

const OPERATION_LABEL: Record<string, string> = {
  CUBA: "Cuba",
  USA: "USA",
  LOCAL: "Local",
};

function saleHref(saleId: string): string {
  return `${ROUTES.sellerVentas}/${saleId}`;
}

/** Resumen compacto de financiación: "2 financieras · 1 acreditada · 1 firmada". */
function financingSummary(f: SellerSaleListFinancing): string | null {
  if (f.providers === 0) return null;
  const pending = f.pendingContract;
  if (f.providers === 1) {
    if (f.accredited > 0) return "Acreditado";
    if (f.signed > 0) return "Firmado";
    if (f.sent > 0) return "Enviado";
    return "Contrato pendiente";
  }
  const parts: string[] = [`${f.providers} financieras`];
  if (f.accredited > 0) parts.push(`${f.accredited} acreditada${f.accredited > 1 ? "s" : ""}`);
  if (f.signed > 0) parts.push(`${f.signed} firmada${f.signed > 1 ? "s" : ""}`);
  if (f.sent > 0) parts.push(`${f.sent} enviada${f.sent > 1 ? "s" : ""}`);
  if (pending > 0) parts.push(`${pending} pendiente${pending > 1 ? "s" : ""}`);
  return parts.join(" · ");
}

function FinancingBadge({ financing }: { financing: SellerSaleListFinancing }) {
  const summary = financingSummary(financing);
  if (!summary) return <span className="text-muted-foreground">—</span>;
  const tone =
    financing.providers > 0 && financing.accredited === financing.providers
      ? "text-success"
      : "text-text-secondary";
  return <span className={tone}>{summary}</span>;
}

/** Producto y variante de cada unidad (hasta 2) — la venta es UNA fila. */
function UnitsPreview({ item }: { item: SellerSaleListItem }) {
  const shown = item.units.slice(0, 2);
  const overflow = Math.max(0, item.unitCount - shown.length);
  if (shown.length === 0) return <span className="text-muted-foreground">Sin productos</span>;
  return (
    <ul className="space-y-0.5">
      {shown.map((u, i) => (
        <li key={i} className="text-text-secondary">
          {u.productName || "Sin modelo"}
          {u.variant && <span className="text-muted-foreground"> · {u.variant}</span>}
        </li>
      ))}
      {overflow > 0 && (
        <li className="text-xs text-muted-foreground">
          +{overflow} {overflow > 1 ? "unidades" : "unidad"} más
        </li>
      )}
    </ul>
  );
}

function ViewSaleLink({ item, className }: { item: SellerSaleListItem; className?: string }) {
  return (
    <Link
      href={saleHref(item.saleId)}
      prefetch={false}
      aria-label={"Abrir la venta " + (item.saleNumber ?? "(borrador)")}
      className={cn(
        "inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border-strong px-2.5 text-xs font-medium text-text-secondary transition-colors hover:border-brand/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        className,
      )}
    >
      <EyeIcon size={15} />
      Ver
    </Link>
  );
}

/** Tabla en escritorio. */
function DesktopTable({ items }: { items: SellerSaleListItem[] }) {
  return (
    <div className="hidden overflow-hidden rounded-2xl border border-border bg-surface lg:block">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-3 font-medium">Venta / Fecha</th>
            <th className="px-4 py-3 font-medium">Comprador</th>
            <th className="px-4 py-3 font-medium">Producto · variante</th>
            <th className="px-4 py-3 text-right font-medium">Total</th>
            <th className="px-4 py-3 text-right font-medium">Comisión</th>
            <th className="px-4 py-3 font-medium">Estado</th>
            <th className="px-4 py-3 text-right font-medium">Acción</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const tracks = trackingCodes(item);
            return (
              <tr
                key={item.saleId}
                className="group border-b border-border/60 last:border-0 transition-colors hover:bg-surface-muted/60"
              >
                <td className="px-4 py-3 align-top">
                  <Link
                    href={saleHref(item.saleId)}
                    prefetch={false}
                    className="font-semibold text-foreground focus-visible:outline-none focus-visible:underline"
                  >
                    {item.saleNumber ?? "Borrador"}
                  </Link>
                  <div className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                    {formatSaleListDate(item.saleDate)}
                    {!item.hasExplicitDate && " · s/f"}
                  </div>
                </td>
                <td className="px-4 py-3 align-top text-text-secondary">
                  {item.buyerName ?? (
                    <span className="text-muted-foreground">Sin cliente</span>
                  )}
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {OPERATION_LABEL[item.operationType] ?? item.operationType}
                  </div>
                </td>
                <td className="px-4 py-3 align-top">
                  <UnitsPreview item={item} />
                  {tracks.length > 0 && (
                    <div className="mt-0.5 truncate text-xs tabular-nums text-muted-foreground">
                      {tracks.slice(0, 2).join(" · ")}
                      {tracks.length > 2 && ` +${tracks.length - 2}`}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-right align-top font-semibold tabular-nums text-foreground">
                  {formatCents(item.saleTotalCents)}
                  <div className="mt-0.5 text-xs font-normal text-muted-foreground">
                    {item.unitCount} {item.unitCount === 1 ? "ud." : "uds."}
                  </div>
                </td>
                <td className="px-4 py-3 align-top">
                  <CommissionAmount preview={item.commission} status={item.status} />
                </td>
                <td className="px-4 py-3 align-top">
                  <SaleStatusBadge status={item.status} />
                  {settlementNote(item) && (
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {settlementNote(item)}
                    </div>
                  )}
                  {paidDateLabel(item) && (
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {paidDateLabel(item)}
                    </div>
                  )}
                  {item.financing.providers > 0 && (
                    <div className="mt-1 text-[11px]">
                      <FinancingBadge financing={item.financing} />
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 align-top text-right">
                  <ViewSaleLink item={item} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Tarjetas en móvil/tablet. */
function MobileCards({ items }: { items: SellerSaleListItem[] }) {
  return (
    <ul className="space-y-2.5 lg:hidden">
      {items.map((item) => {
        const tracks = trackingCodes(item);
        return (
          <li key={item.saleId}>
            <Link
              href={saleHref(item.saleId)}
              prefetch={false}
              className={cn(
                "relative block rounded-2xl border border-border bg-surface p-4",
                "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:bg-surface-muted/70",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <span className="font-semibold tabular-nums text-foreground">
                  {item.saleNumber ?? "Borrador"}
                </span>
                <span className="text-right">
                  <SaleStatusBadge status={item.status} />
                  {settlementNote(item) && (
                    <span className="mt-1 block text-[11px] text-muted-foreground">
                      {settlementNote(item)}
                    </span>
                  )}
                  {paidDateLabel(item) && (
                    <span className="mt-1 block text-[11px] text-muted-foreground">
                      {paidDateLabel(item)}
                    </span>
                  )}
                </span>
              </div>

              <div className="mt-2">
                <p className="font-medium text-text-secondary">
                  {item.buyerName ?? (
                    <span className="text-muted-foreground">Sin cliente</span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {OPERATION_LABEL[item.operationType] ?? item.operationType}
                </p>
              </div>

              <div className="mt-2 text-sm">
                <UnitsPreview item={item} />
              </div>

              {tracks.length > 0 && (
                <p className="mt-1 truncate text-xs tabular-nums text-muted-foreground">
                  {tracks.slice(0, 3).join(" · ")}
                  {tracks.length > 3 && ` +${tracks.length - 3}`}
                </p>
              )}

              {item.financing.providers > 0 && (
                <p className="mt-1 text-xs">
                  <span className="text-muted-foreground">Financiación: </span>
                  <FinancingBadge financing={item.financing} />
                </p>
              )}

              <div className="mt-3 flex items-end justify-between gap-3">
                <div>
                  <p className="text-[11px] text-muted-foreground">Total</p>
                  <p className="text-lg font-semibold tabular-nums text-foreground">
                    {formatCents(item.saleTotalCents)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] text-muted-foreground">Comisión</p>
                  <CommissionAmount preview={item.commission} status={item.status} />
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3 border-t border-border/70 pt-2.5">
                <span className="text-xs tabular-nums text-muted-foreground">
                  {formatSaleListDate(item.saleDate)}
                </span>
                <span className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border-strong px-2.5 text-xs font-medium text-text-secondary">
                  <EyeIcon size={15} />
                  Ver
                  <ChevronRightIcon size={14} />
                </span>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function SalesListResults({
  items,
  loading,
}: {
  items: SellerSaleListItem[];
  loading?: boolean;
}) {
  return (
    <div
      className={cn("transition-opacity", loading && "pointer-events-none opacity-60")}
      aria-busy={loading}
    >
      <DesktopTable items={items} />
      <MobileCards items={items} />
    </div>
  );
}
