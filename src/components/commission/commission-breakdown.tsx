import { formatCents } from "@/lib/money";
import type { CommissionBreakdown } from "@/lib/commission";
import { cn } from "@/lib/utils";

/**
 * Desglose de comisión (precio fijo + comisión fija + mitad del adicional).
 * Lo usan el simulador de la ficha de producto, la estimación del formulario
 * de venta y las fichas de venta (estimada o congelada). Solo presenta: los
 * importes vienen de `computeCommission` o del snapshot de `sale_commissions`.
 */
export function CommissionBreakdownList({
  breakdown,
  frozen = false,
  label = "Desglose de comisión",
  className,
}: {
  breakdown: CommissionBreakdown;
  /** Valores congelados al marcar VENDIDA: rotula "utilizado/a". */
  frozen?: boolean;
  label?: string;
  className?: string;
}) {
  const b = breakdown;
  const rows: { term: string; value: string; strong?: boolean; tone?: string }[] = [
    { term: frozen ? "Precio fijo utilizado" : "Precio fijo", value: formatCents(b.fixedPriceCents) },
    { term: frozen ? "Comisión fija utilizada" : "Comisión fija", value: formatCents(b.fixedCommissionCents) },
    { term: frozen ? "Precio final de venta" : "Precio de venta", value: formatCents(b.salePriceCents) },
    { term: "Adicional generado", value: formatCents(b.extraCents) },
    { term: "Para el vendedor", value: formatCents(b.sellerExtraCents), tone: "text-success" },
    { term: "Para la tienda", value: formatCents(b.storeExtraCents) },
    { term: "Comisión total", value: formatCents(b.finalCommissionCents), strong: true },
  ];
  return (
    <dl aria-label={label} className={cn("grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2", className)}>
      {rows.map((r) => (
        <div
          key={r.term}
          className={cn(
            "flex items-baseline justify-between gap-3",
            r.strong && "border-t border-border pt-1.5 text-sm sm:col-span-2",
          )}
        >
          <dt className={r.strong ? "font-semibold text-foreground" : "text-muted-foreground"}>{r.term}</dt>
          <dd className={cn("tabular-nums", r.strong ? "font-semibold text-foreground" : r.tone ?? "text-foreground")}>
            {r.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
