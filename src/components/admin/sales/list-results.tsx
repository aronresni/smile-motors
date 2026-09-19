import Link from "next/link";
import { formatCents } from "@/lib/money";
import { formatSaleListDate } from "@/components/seller/ventas/list/format";
import type { AdminSaleListItem } from "@/lib/admin/sales-list";
import { StatusBadge, statusLabel } from "@/components/ui/status-badge";

function StatusPill({ status }: { status: string }) {
  return <StatusBadge domain="sale" status={status} />;
}

function collectionText(item: AdminSaleListItem): { label: string; hint: string | null; tone: string } {
  if (item.status === "PAID") {
    return { label: "Pagada", hint: item.paidAt ? formatWhen(item.paidAt) : null, tone: "text-success" };
  }
  if (item.collectionStatus === "READY_TO_PAY") {
    return { label: "Listo para pagar", hint: `${formatCents(item.collectedCents)} / ${formatCents(item.saleTotalCents)}`, tone: "text-success" };
  }
  if (item.collectionStatus === "PENDING_COLLECTION") {
    return {
      label: `${formatCents(item.collectedCents)} / ${formatCents(item.saleTotalCents)}`,
      hint: `Faltan ${formatCents(item.outstandingCents)}`,
      tone: "text-warning",
    };
  }
  return { label: "—", hint: null, tone: "text-muted-foreground" };
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("es-DO", { dateStyle: "medium" }).format(d);
}

function FinancingSummary({ item }: { item: AdminSaleListItem }) {
  if (item.financing.providers === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] font-medium text-muted-foreground">
        {item.financing.providers} financiera{item.financing.providers > 1 ? "s" : ""}
      </p>
      <ul className="space-y-0.5">
        {item.financingProviders.slice(0, 3).map((p, i) => (
          <li key={i} className="flex items-center gap-1 text-[11px]">
            <span className="font-medium text-text-secondary">{p.providerName}</span>
            <span className="text-muted-foreground">{statusLabel("contract", p.status)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function UnitsPreview({ item }: { item: AdminSaleListItem }) {
  const names = Array.from(new Set(item.units.map((u) => u.productName || "Sin modelo"))).slice(0, 2);
  const overflow = item.unitCount - names.length;
  return (
    <span className="text-text-secondary">
      {names.join(" · ")}
      {overflow > 0 && <span className="text-muted-foreground"> +{overflow} más</span>}
    </span>
  );
}

function DesktopTable({ items }: { items: AdminSaleListItem[] }) {
  return (
    <div className="hidden overflow-hidden rounded-xl border border-border lg:block">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground border-border bg-surface">
              <th className="px-3 py-2.5 font-medium">Venta / Fecha</th>
              <th className="px-3 py-2.5 font-medium">Vendedor</th>
              <th className="px-3 py-2.5 font-medium">Cliente</th>
              <th className="px-3 py-2.5 font-medium">Productos</th>
              <th className="px-3 py-2.5 text-right font-medium">Total</th>
              <th className="px-3 py-2.5 font-medium">Financiación</th>
              <th className="px-3 py-2.5 font-medium">Cobro</th>
              <th className="px-3 py-2.5 font-medium">Estado</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const col = collectionText(item);
              return (
                <tr key={item.saleId} className="border-b last:border-0 border-border/70">
                  <td className="px-3 py-2.5 align-top">
                    <Link href={`/admin/ventas/${item.saleId}`} className="font-medium hover:underline">
                      {item.saleNumber ?? "Sin número"}
                    </Link>
                    <div className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                      {formatSaleListDate(item.saleDate)}
                      {!item.hasExplicitDate && " · s/f"}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 align-top text-text-secondary">
                    {item.sellerName ?? "—"}
                  </td>
                  <td className="px-3 py-2.5 align-top text-text-secondary">
                    {item.buyerName ?? "—"}
                  </td>
                  <td className="px-3 py-2.5 align-top"><UnitsPreview item={item} /></td>
                  <td className="px-3 py-2.5 text-right align-top font-medium tabular-nums">
                    {formatCents(item.saleTotalCents)}
                  </td>
                  <td className="px-3 py-2.5 align-top"><FinancingSummary item={item} /></td>
                  <td className="px-3 py-2.5 align-top">
                    <p className={`text-xs font-medium tabular-nums ${col.tone}`}>{col.label}</p>
                    {col.hint && <p className="text-[11px] text-muted-foreground">{col.hint}</p>}
                  </td>
                  <td className="px-3 py-2.5 align-top"><StatusPill status={item.status} /></td>
                  <td className="px-3 py-2.5 text-right align-top">
                    <Link
                      href={`/admin/ventas/${item.saleId}`}
                      className="inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium border-border hover:bg-surface-elevated"
                    >
                      Ver
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MobileCards({ items }: { items: AdminSaleListItem[] }) {
  return (
    <ul className="space-y-2.5 lg:hidden">
      {items.map((item) => {
        const col = collectionText(item);
        return (
          <li key={item.saleId}>
            <Link
              href={`/admin/ventas/${item.saleId}`}
              className="block rounded-xl border p-4 active:bg-surface border-border bg-surface"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="font-semibold tabular-nums">{item.saleNumber ?? "Sin número"}</span>
                <StatusPill status={item.status} />
              </div>
              <p className="mt-1.5 text-sm text-text-secondary">
                {item.buyerName ?? "Sin cliente"}
              </p>
              <p className="text-xs text-muted-foreground">Vendedor: {item.sellerName ?? "—"}</p>
              <div className="mt-2 text-sm"><UnitsPreview item={item} /></div>
              {item.financing.providers > 0 && (
                <div className="mt-2"><FinancingSummary item={item} /></div>
              )}
              <div className="mt-3 flex items-end justify-between gap-3">
                <div>
                  <p className={`text-xs font-medium tabular-nums ${col.tone}`}>{col.label}</p>
                  {col.hint && <p className="text-[11px] text-muted-foreground">{col.hint}</p>}
                </div>
                <div className="text-right">
                  <span className="block text-lg font-semibold tabular-nums">{formatCents(item.saleTotalCents)}</span>
                  <span className="text-[11px] text-muted-foreground">{formatSaleListDate(item.saleDate)}</span>
                </div>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function AdminSalesListResults({ items }: { items: AdminSaleListItem[] }) {
  return (
    <div>
      <DesktopTable items={items} />
      <MobileCards items={items} />
    </div>
  );
}
