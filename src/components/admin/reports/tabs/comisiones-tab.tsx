import Link from "next/link";
import { ROUTES } from "@/lib/constants";
import { formatCents } from "@/lib/money";
import type { CommissionsReport } from "@/lib/admin/reports";
import { BarList } from "@/components/admin/reports/bar-list";
import { ReportKpi, ReportSectionLabel } from "@/components/admin/reports/report-kpi";
import { ExportCsvLink } from "@/components/admin/reports/export-csv-link";

export function ComisionesTab({ report, start, end }: { report: CommissionsReport; start: string | null; end: string | null }) {
  const { current, bySeller, byProduct, avgCommissionPerUnitCents } = report;

  return (
    <div className="space-y-5">
      <div>
        <ReportSectionLabel>Estado actual (no depende del período) — sale_commissions es la única fuente</ReportSectionLabel>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <ReportKpi label="De ventas por cobrar" value={String(current.pendingCount)} />
          <ReportKpi label="Monto de ventas por cobrar" value={formatCents(current.pendingCents)} />
          <ReportKpi label="De ventas cobradas" value={String(current.eligibleCount)} tone="accent" />
          <ReportKpi label="Monto de ventas cobradas" value={formatCents(current.eligibleCents)} tone="accent" />
        </div>
        {avgCommissionPerUnitCents != null && (
          <p className="mt-2 text-xs text-muted-foreground">Comisión promedio por unidad (período): {formatCents(avgCommissionPerUnitCents)}</p>
        )}
        <div className="mt-2">
          <Link href={ROUTES.adminComisiones} className="text-xs font-medium text-muted-foreground hover:text-foreground">
            Ver Comisiones →
          </Link>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <ReportSectionLabel>Por vendedor</ReportSectionLabel>
        <ExportCsvLink report="commissions" start={start} end={end} />
      </div>
      {bySeller.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin comisiones registradas.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground border-border bg-surface">
                <th className="px-3 py-2.5 font-medium">Vendedor</th>
                <th className="px-3 py-2.5 text-right font-medium">Venta por cobrar</th>
                <th className="px-3 py-2.5 text-right font-medium">Venta cobrada</th>
              </tr>
            </thead>
            <tbody>
              {bySeller.map((s) => (
                <tr key={s.sellerId} className="border-b last:border-0 border-border/70">
                  <td className="px-3 py-2.5 align-top font-medium">
                    <Link href={`${ROUTES.adminVendedores}/${s.sellerId}`} className="hover:underline">{s.sellerName}</Link>
                  </td>
                  <td className="px-3 py-2.5 text-right align-top tabular-nums">{formatCents(s.pendingCents)}</td>
                  <td className="px-3 py-2.5 text-right align-top tabular-nums font-medium">{formatCents(s.eligibleCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div>
        <ReportSectionLabel>Por producto (histórico)</ReportSectionLabel>
        <div className="mt-2 rounded-xl border p-4 border-border bg-surface">
          <BarList items={byProduct.map((p) => ({ label: p.productName, value: p.commissionCents }))} formatValue={formatCents} />
        </div>
      </div>
    </div>
  );
}
