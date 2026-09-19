import { formatCents } from "@/lib/money";
import type { LiquidationAdjustment } from "@/lib/sales/liquidation-types";

const TYPE_LABEL: Record<string, string> = {
  BONO: "Bono",
  AJUSTE_POSITIVO: "Ajuste positivo",
  AJUSTE_NEGATIVO: "Ajuste negativo",
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("es-DO", { dateStyle: "medium", timeStyle: "short" }).format(d);
}

/** Bonos/ajustes manuales — SIEMPRE entidades separadas de la comisión
 * original; nunca se reescribe una fila de sale_commissions para reflejarlos. */
export function LiquidationAdjustmentsList({ adjustments }: { adjustments: LiquidationAdjustment[] }) {
  if (adjustments.length === 0) {
    return <p className="text-sm text-muted-foreground">Sin ajustes manuales.</p>;
  }
  return (
    <ul className="space-y-2">
      {adjustments.map((a, i) => {
        const negative = a.type === "AJUSTE_NEGATIVO";
        return (
          <li key={a.id ?? i} className="rounded-lg p-3 text-sm bg-surface-muted">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{TYPE_LABEL[a.type] ?? a.type}</span>
              <span className={`tabular-nums font-semibold ${negative ? "text-danger" : "text-success"}`}>
                {negative ? "-" : "+"}
                {formatCents(a.amountCents)}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{a.reason}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {formatDateTime(a.createdAt)}
              {a.createdByName && ` · ${a.createdByName}`}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
