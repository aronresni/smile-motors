import Link from "next/link";
import { ROUTES } from "@/lib/constants";
import { formatCents } from "@/lib/money";
import type { LiquidationWeekRow } from "@/lib/admin/liquidations";
import { CreateDraftButton } from "@/components/admin/liquidations/create-draft-button";
import { StatusBadge } from "@/components/ui/status-badge";

export function LiquidationWeekTable({ rows, weekStart }: { rows: LiquidationWeekRow[]; weekStart: string }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed px-6 py-14 text-center border-border">
        <p className="text-sm font-medium text-text-secondary">
          Sin actividad ni comisiones elegibles para ningún vendedor esta semana.
        </p>
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground border-border bg-surface">
              <th className="px-3 py-2.5 font-medium">Vendedor</th>
              <th className="px-3 py-2.5 font-medium text-right">Ventas Pending</th>
              <th className="px-3 py-2.5 font-medium text-right">Ventas Sold</th>
              <th className="px-3 py-2.5 font-medium text-right">Comisiones elegibles</th>
              <th className="px-3 py-2.5 font-medium text-right">Subtotal</th>
              <th className="px-3 py-2.5 font-medium text-right">Ajustes</th>
              <th className="px-3 py-2.5 font-medium text-right">Total</th>
              <th className="px-3 py-2.5 font-medium">Estado</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.sellerId} className="border-b last:border-0 border-border/70">
                <td className="px-3 py-2.5 align-top font-medium">{row.sellerName ?? "—"}</td>
                <td className="px-3 py-2.5 align-top text-right tabular-nums">{row.pendingSalesCount}</td>
                <td className="px-3 py-2.5 align-top text-right tabular-nums">{row.soldSalesCount}</td>
                <td className="px-3 py-2.5 align-top text-right tabular-nums">{row.eligibleCommissionsCount}</td>
                <td className="px-3 py-2.5 align-top text-right tabular-nums">{formatCents(row.subtotalCents)}</td>
                <td className="px-3 py-2.5 align-top text-right tabular-nums">{formatCents(row.adjustmentsCents)}</td>
                <td className="px-3 py-2.5 align-top text-right font-semibold tabular-nums">{formatCents(row.totalCents)}</td>
                <td className="px-3 py-2.5 align-top">
                  <StatusBadge domain="liquidation" status={row.status} size="xs" />
                </td>
                <td className="px-3 py-2.5 align-top text-right">
                  {row.liquidationId ? (
                    <Link
                      href={`${ROUTES.adminLiquidaciones}/${row.liquidationId}`}
                      className="inline-flex items-center rounded-lg border px-2.5 py-1 text-xs font-medium border-border hover:bg-surface-elevated"
                    >
                      Ver →
                    </Link>
                  ) : row.eligibleCommissionsCount > 0 ? (
                    <CreateDraftButton sellerId={row.sellerId} weekStart={weekStart} />
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
