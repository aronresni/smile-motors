import Link from "next/link";
import { ROUTES } from "@/lib/constants";
import type { AlertsSummary } from "@/lib/admin/alerts";

/** Sección compacta para /admin — no rediseña el resto del panel. Antes
 * mostraba solo los 4 conteos del Centro de Aprobaciones; ahora refleja el
 * total real de Alertas (que los incluye) y enlaza a /admin/alertas — el
 * nav badge "Aprobaciones" sigue siendo su propio conteo, sin cambios. */
export function RequierenAtencionWidget({ summary }: { summary: AlertsSummary }) {
  const { includesApprovalCenter: c, categories } = summary;
  return (
    <div className="rounded-xl border p-4 border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Requieren atención</h2>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {summary.total} <span className="text-sm font-normal text-muted-foreground">acciones</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {c.edicionesSolicitadas} edicion{c.edicionesSolicitadas === 1 ? "" : "es"} pendiente{c.edicionesSolicitadas === 1 ? "" : "s"} ·{" "}
            {c.contratosRequierenAccion} contrato{c.contratosRequierenAccion === 1 ? "" : "s"} ·{" "}
            {c.pendientesACobrar} pendiente{c.pendientesACobrar === 1 ? "" : "s"} a cobrar ·{" "}
            {c.listasParaPagar} lista{c.listasParaPagar === 1 ? "" : "s"} para pagar ·{" "}
            {categories.LIQUIDACIONES} liquidaci{categories.LIQUIDACIONES === 1 ? "ón" : "ones"}
          </p>
        </div>
        <Link
          href={ROUTES.adminAlertas}
          className="inline-flex items-center rounded-md border px-3 py-1.5 text-sm font-medium border-border hover:bg-surface-elevated"
        >
          Ver alertas →
        </Link>
      </div>
    </div>
  );
}
