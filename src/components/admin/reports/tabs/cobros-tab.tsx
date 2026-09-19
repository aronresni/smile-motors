import Link from "next/link";
import { ROUTES } from "@/lib/constants";
import { formatCents } from "@/lib/money";
import type { CollectionReport } from "@/lib/admin/reports";
import { BarList } from "@/components/admin/reports/bar-list";
import { ReportKpi, ReportSectionLabel } from "@/components/admin/reports/report-kpi";
import { ExportCsvLink } from "@/components/admin/reports/export-csv-link";

export function CobrosTab({ report, start, end }: { report: CollectionReport; start: string | null; end: string | null }) {
  const { current, period } = report;
  const aging = [
    { label: "0–2 días", value: current.agingBuckets.d0to2 },
    { label: "3–7 días", value: current.agingBuckets.d3to7 },
    { label: "8–14 días", value: current.agingBuckets.d8to14 },
    { label: "15+ días", value: current.agingBuckets.d15plus },
  ];

  return (
    <div className="space-y-5">
      <div>
        <ReportSectionLabel>Estado actual (no depende del período)</ReportSectionLabel>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <ReportKpi label="Pendiente a cobrar" value={formatCents(current.totalOutstandingCents)} tone="warning" />
          <ReportKpi label="Cobrado/acreditado" value={formatCents(current.totalSettledCents)} tone="success" />
          <ReportKpi label="Ventas pendientes a cobrar" value={String(current.pendingCollectionCount)} />
          <ReportKpi label="Ventas listas para pagar" value={String(current.readyToPayCount)} tone="accent" />
        </div>
        <div className="mt-2">
          <Link href={`${ROUTES.adminVentas}?collection=pending_collection`} className="text-xs font-medium text-muted-foreground hover:text-foreground">
            Ver ventas pendientes a cobrar →
          </Link>
        </div>
      </div>

      <div>
        <ReportSectionLabel>Antigüedad de ventas vendidas con saldo pendiente (grupos, no &ldquo;vencido&rdquo;)</ReportSectionLabel>
        <div className="mt-2 rounded-xl border p-4 border-border bg-surface">
          <BarList items={aging} formatValue={(v) => `${v} venta${v === 1 ? "" : "s"}`} />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <ReportSectionLabel>Pagadas en el período seleccionado</ReportSectionLabel>
        <ExportCsvLink report="collection" start={start} end={end} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <ReportKpi label="Ventas pagadas" value={String(period.paidSalesCount)} />
        <ReportKpi label="Monto pagado" value={formatCents(period.paidAmountCents)} tone="success" />
      </div>
    </div>
  );
}
