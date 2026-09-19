import type { ApprovalsCounts } from "@/lib/admin/approvals";

function KpiCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border p-3.5 border-border bg-surface">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${value > 0 ? "text-foreground" : "text-muted-foreground"}`}>
        {value}
      </p>
    </div>
  );
}

export function ApprovalsSummary({ counts }: { counts: ApprovalsCounts }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <KpiCard label="Total pendientes" value={counts.totalPending} />
      <KpiCard label="Ediciones solicitadas" value={counts.edicionesSolicitadas} />
      <KpiCard label="Contratos requieren acción" value={counts.contratosRequierenAccion} />
      <KpiCard label="Pendientes a cobrar" value={counts.pendientesACobrar} />
      <KpiCard label="Listas para pagar" value={counts.listasParaPagar} />
    </div>
  );
}
