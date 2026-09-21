"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { CalculatorIcon, PlusIcon } from "@/components/ui/icons";
import { swatchFor } from "@/components/seller/stock/variant-colors";
import type { StockProductDetail } from "@/lib/seller/stock";

/**
 * Elegir color (opcional) y llevarse el producto a la calculadora o a una
 * venta nueva. Los dos caminos preseleccionan el producto por la URL; el
 * servidor vuelve a leerlo y valida que siga activo antes de usarlo.
 */
export function ProductActions({ product }: { product: StockProductDetail }) {
  const router = useRouter();
  const [variantId, setVariantId] = useState<string | null>(
    product.variants.length === 1 ? product.variants[0].id : null,
  );

  const sellable = product.availability === "DISPONIBLE";

  const href = (base: string) => {
    const sp = new URLSearchParams({ producto: product.id });
    if (variantId) sp.set("variante", variantId);
    return `${base}?${sp.toString()}`;
  };

  return (
    <div className="space-y-3">
      {product.variants.length > 0 && (
        <fieldset className="space-y-1.5">
          <legend className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Colores disponibles
          </legend>
          <ul className="flex flex-wrap gap-1.5">
            {product.variants.map((v) => {
              const color = swatchFor(v.label);
              const active = variantId === v.id;
              return (
                <li key={v.id}>
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => setVariantId(active ? null : v.id)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full border py-1 pl-1.5 pr-2.5 text-[11px] font-medium capitalize transition-colors",
                      active
                        ? "border-brand bg-brand-soft text-foreground"
                        : "border-border bg-surface-muted text-text-secondary hover:text-foreground",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "h-3.5 w-3.5 rounded-full border",
                        color ? "border-white/25" : "border-dashed border-muted-foreground/60",
                      )}
                      style={color ? { backgroundColor: color } : undefined}
                    />
                    {v.label.toLowerCase()}
                  </button>
                </li>
              );
            })}
          </ul>
        </fieldset>
      )}

      {!sellable && (
        <p className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          {product.unavailableReason}
        </p>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Button
          variant="primary"
          size="lg"
          disabled={!sellable}
          icon={<CalculatorIcon size={17} />}
          onClick={() => router.push(href(ROUTES.sellerCalculadora))}
        >
          Usar en calculadora
        </Button>
        <Button
          variant="secondary"
          size="lg"
          disabled={!sellable}
          icon={<PlusIcon size={17} />}
          onClick={() => router.push(href(ROUTES.sellerVentaNuevaCuba))}
        >
          Crear venta
        </Button>
      </div>
    </div>
  );
}
