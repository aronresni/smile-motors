import { formatCents } from "@/lib/money";
import type { FinancingProviderRow, DirectPaymentRow } from "@/lib/admin/reports";
import { ReportSectionLabel } from "@/components/admin/reports/report-kpi";
import { ExportCsvLink } from "@/components/admin/reports/export-csv-link";

const METHOD_LABEL: Record<string, string> = { CARD: "Tarjeta", ZELLE: "Zelle", INTERNAL: "Interno/efectivo" };

export function FinancierasTab({
  providers, directPayments, start, end,
}: {
  providers: FinancingProviderRow[];
  directPayments: DirectPaymentRow[];
  start: string | null;
  end: string | null;
}) {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <ReportSectionLabel>Financieras (por asignación — nunca el total de la venta atribuido a más de una)</ReportSectionLabel>
        <ExportCsvLink report="financing" start={start} end={end} />
      </div>
      {providers.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin financieras usadas en este período.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground border-border bg-surface">
                  <th className="px-3 py-2.5 font-medium">Proveedor</th>
                  <th className="px-3 py-2.5 text-right font-medium">Ventas</th>
                  <th className="px-3 py-2.5 text-right font-medium">Asignaciones</th>
                  <th className="px-3 py-2.5 text-right font-medium">Bruto</th>
                  <th className="px-3 py-2.5 text-right font-medium">Fee</th>
                  <th className="px-3 py-2.5 text-right font-medium">Neto asignado</th>
                  <th className="px-3 py-2.5 text-right font-medium">Neto acreditado</th>
                  <th className="px-3 py-2.5 text-right font-medium">Enviados/Firmados/Acreditados</th>
                </tr>
              </thead>
              <tbody>
                {providers.map((p) => (
                  <tr key={p.providerName} className="border-b last:border-0 border-border/70">
                    <td className="px-3 py-2.5 align-top font-medium">{p.providerName}</td>
                    <td className="px-3 py-2.5 text-right align-top tabular-nums">{p.salesCount}</td>
                    <td className="px-3 py-2.5 text-right align-top tabular-nums">{p.allocationsCount}</td>
                    <td className="px-3 py-2.5 text-right align-top tabular-nums">{formatCents(p.grossAllocatedCents)}</td>
                    <td className="px-3 py-2.5 text-right align-top tabular-nums text-muted-foreground">{formatCents(p.feesCents)}</td>
                    <td className="px-3 py-2.5 text-right align-top tabular-nums font-medium">{formatCents(p.netAllocatedCents)}</td>
                    <td className="px-3 py-2.5 text-right align-top tabular-nums text-success">{formatCents(p.netAccreditedCents)}</td>
                    <td className="px-3 py-2.5 text-right align-top tabular-nums text-muted-foreground">{p.contractsSent}/{p.contractsSigned}/{p.contractsAccredited}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div>
        <ReportSectionLabel>Pagos directos</ReportSectionLabel>
        {directPayments.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Sin pagos directos en este período.</p>
        ) : (
          <div className="mt-2 overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground border-border bg-surface">
                  <th className="px-3 py-2.5 font-medium">Método</th>
                  <th className="px-3 py-2.5 text-right font-medium">Asignado</th>
                  <th className="px-3 py-2.5 text-right font-medium">Cobrado</th>
                  <th className="px-3 py-2.5 text-right font-medium">Pendiente</th>
                </tr>
              </thead>
              <tbody>
                {directPayments.map((d) => (
                  <tr key={d.methodType} className="border-b last:border-0 border-border/70">
                    <td className="px-3 py-2.5 align-top font-medium">{METHOD_LABEL[d.methodType] ?? d.methodType}</td>
                    <td className="px-3 py-2.5 text-right align-top tabular-nums">{formatCents(d.allocatedCents)}</td>
                    <td className="px-3 py-2.5 text-right align-top tabular-nums text-success">{formatCents(d.settledCents)}</td>
                    <td className="px-3 py-2.5 text-right align-top tabular-nums text-warning">{formatCents(d.pendingCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
