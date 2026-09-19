import type { AlertsSummary } from "@/lib/admin/alerts";

function Card({ label, value, tone }: { label: string; value: number; tone?: "warn" | "accent" }) {
  return (
    <div className="rounded-xl border p-3.5 border-border bg-surface">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${tone === "warn" ? "text-warning" : tone === "accent" ? "text-info" : "text-foreground"}`}>
        {value}
      </p>
    </div>
  );
}

/** Conteos por categoría — Aprobaciones sigue siendo su propio badge en el
 * nav; aquí se ve explícitamente que Alertas los incluye, no los oculta ni
 * los duplica engañosamente. */
export function AlertsSummaryCards({ summary }: { summary: AlertsSummary }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <Card label="Aprobaciones" value={summary.categories.APROBACIONES} />
        <Card label="Contratos" value={summary.categories.CONTRATOS} />
        <Card label="Cobros" value={summary.categories.COBROS} />
        <Card label="Pagos" value={summary.categories.PAGOS} tone="accent" />
        <Card label="Comisiones" value={summary.categories.COMISIONES} tone="warn" />
        <Card label="Liquidaciones" value={summary.categories.LIQUIDACIONES} />
        <Card label="Vendedores" value={summary.categories.VENDEDORES} />
        <Card label="Logística" value={summary.categories.LOGISTICA} />
      </div>
      <p className="text-[11px] text-muted-foreground">
        {summary.total} acciones requieren atención · incluye las {summary.includesApprovalCenter.edicionesSolicitadas
          + summary.includesApprovalCenter.contratosRequierenAccion + summary.includesApprovalCenter.pendientesACobrar
          + summary.includesApprovalCenter.listasParaPagar} del Centro de Aprobaciones (no se cuentan dos veces).
      </p>
    </div>
  );
}
