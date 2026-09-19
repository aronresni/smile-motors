import type { LogisticsKpis } from "@/lib/admin/logistics";

function Card({ label, value, tone }: { label: string; value: number; tone?: "warn" | "accent" | "success" }) {
  return (
    <div className="rounded-xl border p-3.5 border-border bg-surface">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${
        tone === "warn" ? "text-danger"
        : tone === "accent" ? "text-info"
        : tone === "success" ? "text-success"
        : "text-foreground"
      }`}>
        {value}
      </p>
    </div>
  );
}

/** KPIs operativos ACTUALES — nunca domina el volumen histórico entregado. */
export function LogisticsKpiCards({ kpis }: { kpis: LogisticsKpis }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
      <Card label="Pendientes de preparar" value={kpis.pendingPreparation} />
      <Card label="Listas" value={kpis.ready} />
      <Card label="Despachadas" value={kpis.dispatched} tone="accent" />
      <Card label="En tránsito" value={kpis.inTransit} tone="accent" />
      <Card label="En Cuba" value={kpis.inCuba} tone="accent" />
      <Card label="Listas para entrega" value={kpis.readyForDelivery} />
      <Card label="Entregadas" value={kpis.delivered} tone="success" />
      <Card label="En espera" value={kpis.onHold} tone="warn" />
    </div>
  );
}
