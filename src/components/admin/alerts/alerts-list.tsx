import Link from "next/link";
import type { AlertItem } from "@/lib/admin/alerts";
import { formatCents } from "@/lib/money";
import { formatAge } from "@/lib/admin/dealer-time";

const PRIORITY_LABEL: Record<string, string> = { HIGH: "Alta", MEDIUM: "Media", LOW: "Baja" };
const PRIORITY_CLASS: Record<string, string> = {
  HIGH: "border-danger/30 bg-danger/10 text-danger",
  MEDIUM: "border-warning/30 bg-warning/10 text-warning",
  LOW: "border-border bg-surface-muted text-muted-foreground",
};

function Detail({ item }: { item: AlertItem }) {
  return (
    <>
      <p className="font-medium">{item.title}</p>
      <p className="text-xs text-muted-foreground">
        {item.detail}
        {item.amountCents != null && <span className="ml-1 tabular-nums text-muted-foreground">· {formatCents(item.amountCents)}</span>}
      </p>
    </>
  );
}

export function AlertsList({ items }: { items: AlertItem[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed px-6 py-14 text-center border-border">
        <p className="text-sm font-medium text-text-secondary">Sin alertas con estos filtros.</p>
      </div>
    );
  }

  return (
    <>
      {/* Escritorio */}
      <div className="hidden overflow-hidden rounded-xl border border-border lg:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground border-border bg-surface">
                <th className="px-3 py-2.5 font-medium">Tipo</th>
                <th className="px-3 py-2.5 font-medium">Prioridad</th>
                <th className="px-3 py-2.5 font-medium">Detalle</th>
                <th className="px-3 py-2.5 font-medium">Vendedor</th>
                <th className="px-3 py-2.5 font-medium">Antigüedad</th>
                <th className="px-3 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={`${item.entityType}-${item.entityId}-${i}`} className="border-b last:border-0 border-border/70">
                  <td className="px-3 py-2.5 align-top text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{item.category}</td>
                  <td className="px-3 py-2.5 align-top">
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${PRIORITY_CLASS[item.priority] ?? ""}`}>
                      {PRIORITY_LABEL[item.priority] ?? item.priority}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 align-top"><Detail item={item} /></td>
                  <td className="px-3 py-2.5 align-top text-text-secondary">{item.sellerName ?? "—"}</td>
                  <td className="px-3 py-2.5 align-top text-muted-foreground">{formatAge(item.occurredAt)}</td>
                  <td className="px-3 py-2.5 align-top text-right">
                    <Link href={item.actionUrl} className="inline-flex items-center rounded-lg border px-2.5 py-1 text-xs font-medium border-border hover:bg-surface-elevated">
                      {item.actionLabel} →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Móvil */}
      <ul className="space-y-2.5 lg:hidden">
        {items.map((item, i) => (
          <li key={`${item.entityType}-${item.entityId}-${i}`} className="rounded-xl border p-3.5 border-border">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{item.category}</span>
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${PRIORITY_CLASS[item.priority] ?? ""}`}>
                {PRIORITY_LABEL[item.priority] ?? item.priority}
              </span>
            </div>
            <div className="mt-2"><Detail item={item} /></div>
            <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>{item.sellerName ?? "—"} · {formatAge(item.occurredAt)}</span>
            </div>
            <Link href={item.actionUrl} className="mt-2 inline-flex items-center rounded-lg border px-2.5 py-1 text-xs font-medium border-border hover:bg-surface-elevated">
              {item.actionLabel} →
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
