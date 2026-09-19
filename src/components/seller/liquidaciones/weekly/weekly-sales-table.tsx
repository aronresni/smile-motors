import Link from "next/link";
import { ROUTES } from "@/lib/constants";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { WeeklySaleRow } from "@/lib/seller/weekly-liquidation";
import { DEALER_TIME_ZONE, formatDay } from "@/lib/seller/week-dates";
import { StatusBadge } from "@/components/ui/status-badge";
import { EyeIcon } from "@/components/ui/icons";
import { CommissionAmount } from "@/components/commission/commission-amount";

/**
 * Tabla de "Mis liquidaciones": una FILA por venta (el total nunca se repite
 * por unidad); cada unidad muestra producto, variante y su comisión.
 *  - "confirmed": VENDIDAS/PAGADAS confirmadas en la semana (comisión congelada).
 *  - "upcoming": PENDIENTES (comisión ESTIMADA, no incluida en la liquidación).
 * Escritorio = tabla; móvil = tarjetas.
 */
export type WeeklyTableKind = "confirmed" | "upcoming";

function saleHref(saleId: string) {
  return `${ROUTES.sellerVentas}/${saleId}`;
}

/** Día local del concesionario de un instante (p. ej. `sold_at`). */
function dealerDay(instant: string | null): string | null {
  if (!instant) return null;
  const d = new Date(instant);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DEALER_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

function liquidabilityNote(row: WeeklySaleRow, kind: WeeklyTableKind): { text: string; tone: string } | null {
  if (kind === "upcoming") return null; // el rótulo de la comisión ya lo dice
  if (row.commission.kind !== "FROZEN") return null;
  if (row.countedThisWeekCents > 0) return { text: "Incluida en esta liquidación", tone: "text-success" };
  return { text: "Liquidada en otra semana", tone: "text-muted-foreground" };
}

function unitCommissionText(u: WeeklySaleRow["commission"]["units"][number]): string | null {
  if (u.kind === "FROZEN" && u.cents != null) return formatCents(u.cents);
  if (u.kind === "ESTIMATED" && u.cents != null) return `${formatCents(u.cents)} est.`;
  if (u.kind === "UNAVAILABLE") return "sin calcular";
  return null;
}

function Units({ row }: { row: WeeklySaleRow }) {
  const units = row.commission.units;
  if (units.length === 0) return <span className="text-muted-foreground">Sin productos</span>;
  return (
    <ul className="space-y-1">
      {units.map((u) => (
        <li key={u.saleUnitId} className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="text-text-secondary">
            {u.productName || "Sin modelo"}
            {u.variant && <span className="text-muted-foreground"> · {u.variant}</span>}
          </span>
          {units.length > 1 && unitCommissionText(u) && (
            <span
              className={cn(
                "text-xs tabular-nums",
                u.kind === "FROZEN" ? "text-success" : u.kind === "ESTIMATED" ? "text-warning" : "text-muted-foreground",
              )}
            >
              {unitCommissionText(u)}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function SaleRef({ row, kind }: { row: WeeklySaleRow; kind: WeeklyTableKind }) {
  const soldDay = dealerDay(row.soldAt);
  return (
    <>
      <p className="font-semibold text-foreground">{row.saleNumber ?? "Sin número"}</p>
      {kind === "confirmed" && soldDay ? (
        <>
          <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">Vendida el {formatDay(soldDay)}</p>
          {row.businessDate !== soldDay && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">Creada el {formatDay(row.businessDate)}</p>
          )}
        </>
      ) : (
        <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
          {formatDay(row.businessDate)}
          {!row.hasExplicitDate && " · s/f"}
        </p>
      )}
    </>
  );
}

function ViewButton({ row }: { row: WeeklySaleRow }) {
  return (
    <Link
      href={saleHref(row.saleId)}
      prefetch={false}
      aria-label={"Abrir la venta " + (row.saleNumber ?? "(sin número)")}
      className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg border border-border-strong px-2.5 text-xs font-medium text-text-secondary transition-colors hover:border-brand/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 sm:min-h-9"
    >
      <EyeIcon size={16} />
      <span className="lg:sr-only">Ver</span>
    </Link>
  );
}

function CommissionCell({ row, kind }: { row: WeeklySaleRow; kind: WeeklyTableKind }) {
  const note = liquidabilityNote(row, kind);
  return (
    <>
      <CommissionAmount preview={row.commission} status={row.status} />
      {note && <p className={cn("mt-0.5 text-right text-[11px]", note.tone)}>{note.text}</p>}
    </>
  );
}

export function WeeklySalesTable({
  rows,
  kind,
  label,
}: {
  rows: WeeklySaleRow[];
  kind: WeeklyTableKind;
  /** Nombre accesible de la tabla / lista. */
  label: string;
}) {
  return (
    <>
      <div className="hidden overflow-hidden rounded-2xl border border-border bg-surface lg:block">
        <table className="w-full text-sm" aria-label={label}>
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3 font-medium">Ficha</th>
              <th className="px-4 py-3 font-medium">Comprador</th>
              <th className="px-4 py-3 font-medium">Producto</th>
              <th className="px-4 py-3 text-right font-medium">Total</th>
              <th className="px-4 py-3 text-right font-medium">{kind === "upcoming" ? "Comisión estimada" : "Comisión"}</th>
              <th className="px-4 py-3 font-medium">Estado</th>
              <th className="px-4 py-3 text-right font-medium">Acción</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.saleId} data-sale-id={row.saleId} className="border-b border-border/60 align-top last:border-0">
                <td className="px-4 py-3"><SaleRef row={row} kind={kind} /></td>
                <td className="px-4 py-3 text-text-secondary">
                  {row.buyerName ?? <span className="text-muted-foreground">Sin comprador</span>}
                </td>
                <td className="px-4 py-3"><Units row={row} /></td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums text-foreground">{formatCents(row.saleTotalCents)}</td>
                <td className="px-4 py-3"><CommissionCell row={row} kind={kind} /></td>
                <td className="px-4 py-3"><StatusBadge domain="sale" status={row.status} /></td>
                <td className="px-4 py-3 text-right"><ViewButton row={row} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-2.5 lg:hidden" aria-label={label}>
        {rows.map((row) => (
          <li key={row.saleId} data-sale-id={row.saleId} className="rounded-2xl border border-border bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><SaleRef row={row} kind={kind} /></div>
              <StatusBadge domain="sale" status={row.status} />
            </div>
            <p className="mt-2 font-medium text-text-secondary">
              {row.buyerName ?? <span className="text-muted-foreground">Sin comprador</span>}
            </p>
            <div className="mt-1.5 text-sm"><Units row={row} /></div>
            <div className="mt-3 flex items-end justify-between gap-3">
              <div>
                <p className="text-[11px] text-muted-foreground">Total</p>
                <p className="text-base font-semibold tabular-nums text-foreground">{formatCents(row.saleTotalCents)}</p>
              </div>
              <div className="min-w-0 text-right">
                <p className="text-[11px] text-muted-foreground">{kind === "upcoming" ? "Comisión estimada" : "Comisión"}</p>
                <CommissionCell row={row} kind={kind} />
              </div>
            </div>
            <div className="mt-3 flex justify-end border-t border-border/70 pt-2.5">
              <ViewButton row={row} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
