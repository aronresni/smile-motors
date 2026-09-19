import { formatCents } from "@/lib/money";
import type { CommissionKpis } from "@/lib/admin/commissions";

function KpiCard({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className="rounded-xl border p-3.5 border-border bg-surface">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${tone === "warn" ? "text-warning" : "text-foreground"}`}>
        {value}
      </p>
    </div>
  );
}

export function CommissionKpiCards({ kpis }: { kpis: CommissionKpis }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <KpiCard label="Comisiones pendientes" value={String(kpis.pendingCount)} />
      <KpiCard label="Comisiones de ventas cobradas" value={String(kpis.eligibleCount)} />
      <KpiCard label="Monto pendiente" value={formatCents(kpis.pendingAmountCents)} />
      <KpiCard label="Monto de ventas cobradas" value={formatCents(kpis.eligibleAmountCents)} />
      <KpiCard label="Ventas con comisión" value={String(kpis.salesWithCommissionCount)} />
      <KpiCard label="Configuración faltante" value={String(kpis.missingConfigCount)} tone="warn" />
    </div>
  );
}
