import { formatCents } from "@/lib/money";
import type { ReportsOverview } from "@/lib/admin/reports";
import { ReportKpi, ReportSectionLabel } from "@/components/admin/reports/report-kpi";

export function ResumenTab({ overview }: { overview: ReportsOverview }) {
  return (
    <div className="space-y-4">
      <div>
        <ReportSectionLabel>Actividad del período seleccionado</ReportSectionLabel>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <ReportKpi label="Ventas comerciales" value={String(overview.period.commercialSalesCount)} hint="SOLD + PAID, por fecha de venta" />
          <ReportKpi label="Unidades vendidas" value={String(overview.period.unitsSold)} />
          <ReportKpi label="Ingresos comerciales" value={formatCents(overview.period.commercialRevenueCents)} tone="accent" />
          <ReportKpi label="Ventas pagadas" value={String(overview.period.paidSalesCount)} hint="Por fecha de pago" tone="success" />
          <ReportKpi label="Monto pagado" value={formatCents(overview.period.paidAmountCents)} tone="success" />
          <ReportKpi label="Liquidaciones pagadas" value={formatCents(overview.period.liquidationsPaidAmountCents)} hint="Por fecha de pago de liquidación" />
        </div>
      </div>

      <div>
        <ReportSectionLabel>Estado actual (no depende del período)</ReportSectionLabel>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <ReportKpi label="Ventas pendientes" value={String(overview.current.pendingSalesCount)} hint="Ahora mismo" />
          <ReportKpi label="Pendiente a cobrar" value={formatCents(overview.current.outstandingCollectionCents)} tone="warning" hint="Ahora mismo" />
          <ReportKpi label="Comisiones elegibles" value={formatCents(overview.current.eligibleCommissionCents)} tone="accent" hint="Ahora mismo" />
        </div>
      </div>
    </div>
  );
}
