import type { SalesTrendBucket, ReportsFunnel } from "@/lib/admin/reports";
import { TrendChart } from "@/components/admin/reports/trend-chart";
import { ReportSectionLabel } from "@/components/admin/reports/report-kpi";

function ConversionCard({ label, stat }: { label: string; stat: { sampleSize: number; avgHours: number; medianHours: number } | null }) {
  return (
    <div className="rounded-xl border p-4 border-border bg-surface">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      {stat ? (
        <>
          <p className="mt-1.5 text-xl font-semibold tabular-nums">{stat.avgHours}h promedio</p>
          <p className="mt-1 text-xs text-muted-foreground">Mediana {stat.medianHours}h · {stat.sampleSize} venta{stat.sampleSize === 1 ? "" : "s"}</p>
        </>
      ) : (
        <p className="mt-1.5 text-sm text-muted-foreground">Sin transiciones suficientes en este período.</p>
      )}
    </div>
  );
}

export function VentasTab({
  trend, granularity, funnel,
}: {
  trend: SalesTrendBucket[];
  granularity: string;
  funnel: ReportsFunnel;
}) {
  return (
    <div className="space-y-5">
      <div>
        <ReportSectionLabel>Tendencia de ventas</ReportSectionLabel>
        <div className="mt-2 rounded-xl border p-4 border-border bg-surface">
          <TrendChart buckets={trend} granularity={granularity} />
        </div>
      </div>

      <div>
        <ReportSectionLabel>Embudo operativo (ahora mismo)</ReportSectionLabel>
        <div className="mt-2 grid grid-cols-3 gap-3">
          <div className="rounded-xl border p-4 text-center border-border bg-surface">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Pending</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{funnel.counts.pending}</p>
          </div>
          <div className="rounded-xl border p-4 text-center border-border bg-surface">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Sold</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-info">{funnel.counts.sold}</p>
          </div>
          <div className="rounded-xl border p-4 text-center border-border bg-surface">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Paid</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-success">{funnel.counts.paid}</p>
          </div>
        </div>
      </div>

      <div>
        <ReportSectionLabel>Tiempo de conversión (transiciones del período seleccionado)</ReportSectionLabel>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ConversionCard label="Pending → Sold" stat={funnel.conversion.pendingToSold} />
          <ConversionCard label="Sold → Paid" stat={funnel.conversion.soldToPaid} />
        </div>
      </div>
    </div>
  );
}
