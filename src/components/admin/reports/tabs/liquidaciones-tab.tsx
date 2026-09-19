import Link from "next/link";
import { ROUTES } from "@/lib/constants";
import { formatCents } from "@/lib/money";
import type { LiquidationsReport } from "@/lib/admin/reports";
import { ReportKpi, ReportSectionLabel } from "@/components/admin/reports/report-kpi";
import { ExportCsvLink } from "@/components/admin/reports/export-csv-link";

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("es-DO", { dateStyle: "medium", timeZone: "America/New_York" }).format(d);
}

export function LiquidacionesTab({ report, start, end }: { report: LiquidationsReport; start: string | null; end: string | null }) {
  const { counts, paidInPeriod, items } = report;

  return (
    <div className="space-y-5">
      <div>
        <ReportSectionLabel>Estado actual (no depende del período)</ReportSectionLabel>
        <div className="mt-2 grid grid-cols-3 gap-3">
          <ReportKpi label="Borrador" value={String(counts.draft)} />
          <ReportKpi label="Aprobadas" value={String(counts.approved)} tone="accent" />
          <ReportKpi label="Pagadas" value={String(counts.paid)} tone="success" />
        </div>
        <div className="mt-2">
          <Link href={ROUTES.adminLiquidaciones} className="text-xs font-medium text-muted-foreground hover:text-foreground">
            Ver Liquidaciones →
          </Link>
        </div>
      </div>

      <div>
        <ReportSectionLabel>Pagado en el período — componentes SIEMPRE separados</ReportSectionLabel>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <ReportKpi label="Subtotal comisiones" value={formatCents(paidInPeriod.commissionSubtotalCents)} />
          <ReportKpi label="Bonos" value={formatCents(paidInPeriod.bonusesCents)} tone="success" />
          <ReportKpi label="Ajustes +" value={formatCents(paidInPeriod.positiveAdjustmentsCents)} tone="success" />
          <ReportKpi label="Ajustes -" value={formatCents(paidInPeriod.negativeAdjustmentsCents)} tone="warning" />
          <ReportKpi label="Total pagado" value={formatCents(paidInPeriod.finalPayoutCents)} tone="accent" />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <ReportSectionLabel>Liquidaciones pagadas — por vendedor y semana</ReportSectionLabel>
        <ExportCsvLink report="liquidations" start={start} end={end} />
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin liquidaciones pagadas en este período.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground border-border bg-surface">
                  <th className="px-3 py-2.5 font-medium">Vendedor</th>
                  <th className="px-3 py-2.5 font-medium">Semana</th>
                  <th className="px-3 py-2.5 text-right font-medium">Subtotal</th>
                  <th className="px-3 py-2.5 text-right font-medium">Ajustes</th>
                  <th className="px-3 py-2.5 text-right font-medium">Total</th>
                  <th className="px-3 py-2.5 font-medium">Pagada</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.liquidationId} className="border-b last:border-0 border-border/70">
                    <td className="px-3 py-2.5 align-top font-medium">
                      <Link href={`${ROUTES.adminLiquidaciones}/${row.liquidationId}`} className="hover:underline">{row.sellerName}</Link>
                    </td>
                    <td className="px-3 py-2.5 align-top text-muted-foreground">{row.weekStart} – {row.weekEnd}</td>
                    <td className="px-3 py-2.5 text-right align-top tabular-nums">{formatCents(row.commissionSubtotalCents)}</td>
                    <td className="px-3 py-2.5 text-right align-top tabular-nums">{formatCents(row.adjustmentsCents)}</td>
                    <td className="px-3 py-2.5 text-right align-top tabular-nums font-semibold">{formatCents(row.totalToPayCents)}</td>
                    <td className="px-3 py-2.5 align-top text-muted-foreground">{formatDate(row.paidAt)}</td>
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
