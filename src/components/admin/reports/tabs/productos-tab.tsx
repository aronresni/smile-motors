import Link from "next/link";
import { ROUTES } from "@/lib/constants";
import { formatCents } from "@/lib/money";
import type { ProductReportRow, TopProductRow } from "@/lib/admin/reports";
import { BarList } from "@/components/admin/reports/bar-list";
import { ReportSectionLabel } from "@/components/admin/reports/report-kpi";
import { ExportCsvLink } from "@/components/admin/reports/export-csv-link";

export function ProductosTab({
  items, topByUnits, start, end,
}: {
  items: ProductReportRow[];
  topByUnits: TopProductRow[];
  start: string | null;
  end: string | null;
}) {
  return (
    <div className="space-y-4">
      <div>
        <ReportSectionLabel>Top productos por unidades (período)</ReportSectionLabel>
        <div className="mt-2 rounded-xl border p-4 border-border bg-surface">
          <BarList items={topByUnits.map((p) => ({ label: p.productName, value: p.units }))} formatValue={(v) => `${v} unidades`} />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <ReportSectionLabel>Tabla por producto</ReportSectionLabel>
        <ExportCsvLink report="products" start={start} end={end} />
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
                  <th className="px-3 py-2.5 font-medium">Producto</th>
                  <th className="px-3 py-2.5 text-right font-medium">Unidades vendidas</th>
                  <th className="px-3 py-2.5 text-right font-medium">Ventas</th>
                  <th className="px-3 py-2.5 text-right font-medium">Ingresos</th>
                  <th className="px-3 py-2.5 text-right font-medium">Precio promedio</th>
                  <th className="px-3 py-2.5 text-right font-medium">Pending/Sold/Paid</th>
                  <th className="px-3 py-2.5 text-right font-medium">Comisión generada</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.productId} className="border-b last:border-0 border-border/70">
                    <td className="px-3 py-2.5 align-top">
                      <Link href={`${ROUTES.adminProductos}/${row.productId}`} className="font-medium hover:underline">{row.productName}</Link>
                      {row.category && <p className="text-[11px] text-muted-foreground">{row.category}</p>}
                    </td>
                    <td className="px-3 py-2.5 text-right align-top tabular-nums font-semibold">{row.unitsSold}</td>
                    <td className="px-3 py-2.5 text-right align-top tabular-nums">{row.salesCount}</td>
                    <td className="px-3 py-2.5 text-right align-top tabular-nums">{formatCents(row.revenueCents)}</td>
                    <td className="px-3 py-2.5 text-right align-top tabular-nums">{row.avgSalePriceCents == null ? "—" : formatCents(row.avgSalePriceCents)}</td>
                    <td className="px-3 py-2.5 text-right align-top tabular-nums text-muted-foreground">{row.pendingUnits}/{row.soldUnits}/{row.paidUnits}</td>
                    <td className="px-3 py-2.5 text-right align-top tabular-nums">{formatCents(row.commissionGeneratedCents)}</td>
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
