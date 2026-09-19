import Link from "next/link";
import { ROUTES } from "@/lib/constants";
import { formatCents } from "@/lib/money";
import type { SellerReportRow } from "@/lib/admin/reports";
import { BarList } from "@/components/admin/reports/bar-list";
import { ReportSectionLabel } from "@/components/admin/reports/report-kpi";
import { ExportCsvLink } from "@/components/admin/reports/export-csv-link";

function sortHref(field: string, currentSort: string, currentOrder: string, periodQs: string): string {
  const nextOrder = currentSort === field && currentOrder === "desc" ? "asc" : "desc";
  return `${ROUTES.adminReportes}?tab=vendedores&sort=${field}&order=${nextOrder}${periodQs ? `&${periodQs}` : ""}`;
}

export function VendedoresTab({
  items, sort, order, periodQs, start, end,
}: {
  items: SellerReportRow[];
  sort: string;
  order: string;
  periodQs: string;
  start: string | null;
  end: string | null;
}) {
  const topByRevenue = [...items].sort((a, b) => b.revenueCents - a.revenueCents).slice(0, 8)
    .map((s) => ({ label: s.sellerName, value: s.revenueCents }));

  return (
    <div className="space-y-4">
      <div>
        <ReportSectionLabel>Ingresos por vendedor (período)</ReportSectionLabel>
        <div className="mt-2 rounded-xl border p-4 border-border bg-surface">
          <BarList items={topByRevenue} formatValue={formatCents} />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <ReportSectionLabel>Tabla por vendedor</ReportSectionLabel>
        <ExportCsvLink report="sellers" start={start} end={end} />
      </div>
      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed px-6 py-14 text-center border-border">
          <p className="text-sm font-medium text-text-secondary">Sin datos con estos filtros.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground border-border bg-surface">
                  <th className="px-3 py-2.5 font-medium">Vendedor</th>
                  <th className="px-3 py-2.5 text-right font-medium"><Link href={sortHref("sales", sort, order, periodQs)}>Ventas</Link></th>
                  <th className="px-3 py-2.5 text-right font-medium"><Link href={sortHref("units", sort, order, periodQs)}>Unidades</Link></th>
                  <th className="px-3 py-2.5 text-right font-medium"><Link href={sortHref("revenue", sort, order, periodQs)}>Ingresos</Link></th>
                  <th className="px-3 py-2.5 text-right font-medium">Pending</th>
                  <th className="px-3 py-2.5 text-right font-medium">Sold</th>
                  <th className="px-3 py-2.5 text-right font-medium">Paid</th>
                  <th className="px-3 py-2.5 text-right font-medium">Comisión · venta por cobrar</th>
                  <th className="px-3 py-2.5 text-right font-medium">Comisión · venta cobrada</th>
                  <th className="px-3 py-2.5 text-right font-medium">Liquidado/pagado</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.sellerId} className="border-b last:border-0 border-border/70">
                    <td className="px-3 py-2.5 align-top font-medium">
                      <Link href={`${ROUTES.adminVendedores}/${row.sellerId}`} className="hover:underline">{row.sellerName}</Link>
                    </td>
                    <td className="px-3 py-2.5 text-right align-top tabular-nums">{row.salesCount}</td>
                    <td className="px-3 py-2.5 text-right align-top tabular-nums">{row.units}</td>
                    <td className="px-3 py-2.5 text-right align-top font-semibold tabular-nums">{formatCents(row.revenueCents)}</td>
                    <td className="px-3 py-2.5 text-right align-top tabular-nums text-muted-foreground">{row.pendingCount}</td>
                    <td className="px-3 py-2.5 text-right align-top tabular-nums text-muted-foreground">{row.soldCount}</td>
                    <td className="px-3 py-2.5 text-right align-top tabular-nums text-muted-foreground">{row.paidCount}</td>
                    <td className="px-3 py-2.5 text-right align-top tabular-nums">{formatCents(row.commissionPendingCents)}</td>
                    <td className="px-3 py-2.5 text-right align-top tabular-nums">{formatCents(row.commissionEligibleCents)}</td>
                    <td className="px-3 py-2.5 text-right align-top tabular-nums text-success">{formatCents(row.liquidationPaidCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
