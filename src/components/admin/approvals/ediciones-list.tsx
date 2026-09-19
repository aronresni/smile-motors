import Link from "next/link";
import { ROUTES } from "@/lib/constants";
import type { EditRequestListItem } from "@/lib/admin/approvals";
import { StatusBadge } from "@/components/ui/status-badge";

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("es-DO", { dateStyle: "medium", timeStyle: "short" }).format(d);
}

export function EdicionesList({ items }: { items: EditRequestListItem[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed px-6 py-14 text-center border-border">
        <p className="text-sm font-medium text-text-secondary">No hay solicitudes de edición.</p>
      </div>
    );
  }
  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <li key={item.requestId} className="rounded-xl border p-4 border-border bg-surface">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Solicitud de edición · {formatDate(item.createdAt)}
              </p>
              <p className="mt-0.5 text-sm font-medium">
                Venta: <span className="font-semibold">{item.saleNumber ?? "Sin número"}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                Vendedor: {item.sellerName} · Cliente: {item.buyerName}
              </p>
              <p className="mt-1 text-xs text-text-secondary">
                Cambios: <span className="font-medium">{item.changeCount}</span> · Motivo: &quot;{item.reason}&quot;
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              <StatusBadge domain="editRequest" status={item.status} size="xs" />
              <Link
                href={`${ROUTES.adminAprobaciones}/ediciones/${item.requestId}`}
                className="inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium border-border hover:bg-surface-elevated"
              >
                Revisar
              </Link>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
