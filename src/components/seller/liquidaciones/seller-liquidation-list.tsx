import Link from "next/link";
import { ROUTES } from "@/lib/constants";
import { formatCents } from "@/lib/money";
import type { SellerLiquidationListItem } from "@/lib/seller/liquidations";
import { ChevronRightIcon } from "@/components/seller/icons";
import { StatusBadge } from "@/components/ui/status-badge";

function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("es-DO", { dateStyle: "medium", timeZone: "UTC" }).format(d);
}

export function SellerLiquidationList({ items }: { items: SellerLiquidationListItem[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border px-6 py-14 text-center">
        <p className="text-sm font-medium text-text-secondary">Todavía no tienes liquidaciones.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Aparecerán aquí cuando el admin apruebe la liquidación de una semana con comisiones elegibles tuyas.
        </p>
      </div>
    );
  }
  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <li key={item.liquidationId}>
          <Link
            href={`${ROUTES.sellerLiquidaciones}/${item.liquidationId}`}
            prefetch={false}
            className="relative block rounded-2xl border border-border bg-surface p-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:bg-surface-muted/70"
          >
            <div className="flex items-start justify-between gap-3">
              <span className="font-semibold text-foreground">
                {formatDate(item.weekStart)} – {formatDate(item.weekEnd)}
              </span>
              <StatusBadge domain="liquidation" status={item.status} size="xs" />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1.5 text-xs text-muted-foreground">
              <span>
                Subtotal: <strong className="text-text-secondary">{formatCents(item.subtotalCents)}</strong>
              </span>
              <span>
                Ajustes: <strong className="text-text-secondary">{formatCents(item.adjustmentsCents)}</strong>
              </span>
            </div>
            <div className="mt-3 flex items-end justify-between gap-3">
              <span className="text-lg font-semibold tabular-nums text-foreground">{formatCents(item.totalCents)}</span>
              <ChevronRightIcon size={14} className="text-muted-foreground" />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
