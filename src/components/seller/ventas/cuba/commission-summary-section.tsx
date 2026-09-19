import Link from "next/link";
import { formatCents } from "@/lib/money";
import { ROUTES } from "@/lib/constants";
import { computeCommission, isPricingConfigured, type CommissionBreakdown } from "@/lib/commission";
import type { SaleCommissionEstimate, SaleCommissionItem } from "@/lib/sales/commission-summary";
import { CommissionBreakdownList } from "@/components/commission/commission-breakdown";

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Pendiente",
  ELIGIBLE: "Elegible para liquidación",
  VOID: "Anulada",
};

/** Snapshot congelado → desglose (valores tal cual se guardaron, sin recalcular). */
function frozenBreakdown(item: SaleCommissionItem): CommissionBreakdown {
  return {
    fixedPriceCents: item.referencePriceCents,
    fixedCommissionCents: item.baseCommissionCents,
    salePriceCents: item.salePriceCents,
    extraCents: item.priceDifferenceCents,
    sellerExtraCents: item.sellerDifferenceShareCents,
    storeExtraCents: item.priceDifferenceCents - item.sellerDifferenceShareCents,
    finalCommissionCents: item.finalCommissionCents,
    belowFixedPrice: false,
  };
}

function UnitTitle({ name, variant, badge }: { name: string; variant: string | null; badge: string }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <p className="font-medium">
        {name || "Unidad"}
        {variant && <span className="text-muted-foreground"> · {variant}</span>}
      </p>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{badge}</span>
    </div>
  );
}

/**
 * Desglose transparente de comisión — reutilizado por Admin Sale Detail, Seller
 * Sale Detail y la revisión previa al envío. Comisión VENDIDA = snapshot
 * congelado (precio fijo y comisión fija utilizados); venta pendiente =
 * estimación con la configuración vigente del producto.
 */
export function CommissionSummarySection({
  totalCents,
  items,
  estimates = [],
  isSeller,
}: {
  totalCents: number;
  items: SaleCommissionItem[];
  estimates?: SaleCommissionEstimate[];
  isSeller?: boolean;
}) {
  if (items.length === 0 && estimates.length === 0) return null;

  const estimated = estimates.map((e) => ({
    e,
    b: isPricingConfigured(e.fixedPriceCents, e.fixedCommissionCents)
      ? computeCommission(e.fixedPriceCents, e.fixedCommissionCents!, e.salePriceCents)
      : null,
  }));
  const estimableTotal = estimated.every((x) => x.b && !x.b.belowFixedPrice)
    ? estimated.reduce((a, x) => a + (x.b?.finalCommissionCents ?? 0), 0)
    : null;

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.saleUnitId} className="rounded-lg p-3 text-sm bg-surface-muted">
          <UnitTitle name={item.productName} variant={item.variantName} badge={STATUS_LABEL[item.status] ?? item.status} />
          <CommissionBreakdownList breakdown={frozenBreakdown(item)} frozen label={`Comisión congelada · ${item.productName}`} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Congelada al marcar la venta VENDIDA: no cambia aunque se modifique el precio fijo o la comisión fija del
            producto.
          </p>
        </div>
      ))}

      {estimated.map(({ e, b }) => (
        <div key={e.saleUnitId} className="rounded-lg p-3 text-sm bg-surface-muted">
          <UnitTitle name={e.productName} variant={e.variantName} badge="Estimada" />
          {!b ? (
            <p role="alert" className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
              Este producto no tiene precio fijo de venta o comisión fija: la venta no puede completarse hasta que un
              administrador lo configure
              {e.productId && (
                <>
                  {" "}en la{" "}
                  <Link href={`${ROUTES.adminProductos}/${e.productId}`} className="font-semibold underline underline-offset-2">
                    ficha del producto
                  </Link>
                </>
              )}
              .
            </p>
          ) : b.belowFixedPrice ? (
            <p role="alert" className="rounded-lg border border-danger/30 bg-danger-surface px-3 py-2 text-xs text-danger">
              El precio de venta ({formatCents(e.salePriceCents)}) es inferior al precio fijo vigente (
              {formatCents(b.fixedPriceCents)}): la venta no puede completarse con ese precio.
            </p>
          ) : (
            <>
              <CommissionBreakdownList breakdown={b} label={`Comisión estimada · ${e.productName}`} />
              <p className="mt-2 text-[11px] text-muted-foreground">
                Estimada con la configuración vigente del producto; se congela al marcar la venta VENDIDA.
              </p>
            </>
          )}
        </div>
      ))}

      {items.length > 1 && (
        <div className="flex items-center justify-between border-t pt-2 text-sm font-semibold border-border">
          <span>{isSeller ? "Tu comisión total" : "Total comisión de la venta"}</span>
          <span className="tabular-nums">{formatCents(totalCents)}</span>
        </div>
      )}
      {items.length === 0 && estimates.length > 1 && estimableTotal != null && (
        <div className="flex items-center justify-between border-t pt-2 text-sm font-semibold border-border">
          <span>{isSeller ? "Tu comisión estimada" : "Comisión estimada de la venta"}</span>
          <span className="tabular-nums">{formatCents(estimableTotal)}</span>
        </div>
      )}
    </div>
  );
}
