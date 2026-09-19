import Link from "next/link";
import type { TodoItem } from "@/lib/admin/approvals";
import { formatCents } from "@/lib/money";
import { ROUTES } from "@/lib/constants";

const TYPE_LABEL: Record<string, string> = {
  EDICION: "Edición",
  CONTRATO: "Contrato",
  COBRO: "Cobro",
  LISTA_PARA_PAGAR: "Lista para pagar",
};
const TYPE_CLASS: Record<string, string> = {
  EDICION: "border-purple-300 bg-purple-50 text-purple-700 dark:border-purple-400/30 dark:bg-purple-400/10 dark:text-purple-300",
  CONTRATO: "border-info/30 bg-info/10 text-info",
  COBRO: "border-warning/30 bg-warning/10 text-warning",
  LISTA_PARA_PAGAR: "border-success/30 bg-success/10 text-success",
};

function ageLabel(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diffMs = Date.now() - then;
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (hours < 1) return "Hace unos minutos";
  if (hours < 24) return `Hace ${hours} hora${hours === 1 ? "" : "s"}`;
  const days = Math.floor(hours / 24);
  return `Hace ${days} día${days === 1 ? "" : "s"}`;
}

export function TodoList({ items }: { items: TodoItem[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed px-6 py-14 text-center border-border">
        <p className="text-sm font-medium text-text-secondary">Nada requiere atención ahora.</p>
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={i} className="rounded-xl border p-3.5 border-border bg-surface">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${TYPE_CLASS[item.type] ?? ""}`}>
                  {TYPE_LABEL[item.type] ?? item.type}
                </span>
                <Link href={item.actionUrl} className="truncate text-sm font-medium hover:underline">
                  {item.title}
                </Link>
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {item.subtitle} ·{" "}
                <Link href={`${ROUTES.adminVendedores}/${item.sellerId}`} className="hover:underline">
                  {item.sellerName}
                </Link>
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {item.amountCents != null && (
                <span className="text-sm font-medium tabular-nums text-text-secondary">
                  {formatCents(item.amountCents)}
                </span>
              )}
              <span className="text-[11px] text-muted-foreground">{ageLabel(item.createdAt)}</span>
              <Link
                href={item.actionUrl}
                className="inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium border-border hover:bg-surface-elevated"
              >
                Ver
              </Link>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
