import { formatCents } from "@/lib/money";
import type { LiquidationCommissionItem } from "@/lib/sales/liquidation-types";

function signedCents(cents: number): string {
  const formatted = formatCents(Math.abs(cents));
  return cents > 0 ? `+${formatted}` : cents < 0 ? `-${formatted}` : formatted;
}

/** "COMISIONES A LIQUIDAR" — solo comisiones ya ELIGIBLE, reclamadas por
 * esta liquidación. Compartida entre Admin y Seller. */
export function LiquidationCommissionItems({ items }: { items: LiquidationCommissionItem[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">Sin comisiones elegibles reclamadas todavía.</p>;
  }
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground border-border bg-surface">
              <th className="px-3 py-2.5 font-medium">Venta / Producto</th>
              <th className="px-3 py-2.5 font-medium text-right">Precio fijo</th>
              <th className="px-3 py-2.5 font-medium text-right">Vendido</th>
              <th className="px-3 py-2.5 font-medium text-right">Adicional</th>
              <th className="px-3 py-2.5 font-medium text-right">Comisión fija</th>
              <th className="px-3 py-2.5 font-medium text-right">50%</th>
              <th className="px-3 py-2.5 font-medium text-right">Comisión</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={item.saleCommissionId ?? `${item.saleId}-${i}`} className="border-b last:border-0 border-border/70">
                <td className="px-3 py-2.5 align-top">
                  <p className="font-medium">{item.saleNumber ?? "Sin número"}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.productName}
                    {item.variantName && <span className="text-muted-foreground"> · {item.variantName}</span>}
                  </p>
                </td>
                <td className="px-3 py-2.5 align-top text-right tabular-nums">{formatCents(item.referencePriceCents)}</td>
                <td className="px-3 py-2.5 align-top text-right tabular-nums">{formatCents(item.salePriceCents)}</td>
                <td className={`px-3 py-2.5 align-top text-right tabular-nums ${item.priceDifferenceCents > 0 ? "text-success" : item.priceDifferenceCents < 0 ? "text-danger" : ""}`}>
                  {signedCents(item.priceDifferenceCents)}
                </td>
                <td className="px-3 py-2.5 align-top text-right tabular-nums">{formatCents(item.baseCommissionCents)}</td>
                <td className={`px-3 py-2.5 align-top text-right tabular-nums ${item.sellerDifferenceShareCents > 0 ? "text-success" : item.sellerDifferenceShareCents < 0 ? "text-danger" : ""}`}>
                  {signedCents(item.sellerDifferenceShareCents)}
                </td>
                <td className="px-3 py-2.5 align-top text-right font-semibold tabular-nums">{formatCents(item.finalCommissionCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
