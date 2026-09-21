import Link from "next/link";
import { ROUTES } from "@/lib/constants";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { ChevronRightIcon } from "@/components/ui/icons";
import type { StockProduct } from "@/lib/seller/stock";
import { ProductThumb } from "@/components/seller/stock/product-thumb";
import { VariantDots } from "@/components/seller/stock/variant-colors";

export function AvailabilityBadge({
  availability,
  className,
}: {
  availability: StockProduct["availability"];
  className?: string;
}) {
  const ok = availability === "DISPONIBLE";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em]",
        ok
          ? "bg-success/15 text-success"
          : "bg-surface-muted text-muted-foreground",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn("h-1.5 w-1.5 rounded-full", ok ? "bg-success" : "bg-muted-foreground")}
      />
      {ok ? "Disponible" : "No disponible"}
    </span>
  );
}

/** Precio que gobierna la venta + referencias de cotización. */
export function PriceBlock({ product }: { product: StockProduct }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        Precio de venta (mínimo)
      </p>
      <p className="text-lg font-semibold tabular-nums leading-none text-brand">
        {product.fixedPriceCents != null
          ? formatCents(product.fixedPriceCents)
          : "Sin configurar"}
      </p>
      <p className="text-[11px] tabular-nums text-muted-foreground">
        {product.cubaPriceCents != null && (
          <span>Cuba {formatCents(product.cubaPriceCents)}</span>
        )}
        {product.cubaPriceCents != null && product.usaPriceCents != null && (
          <span aria-hidden="true"> · </span>
        )}
        {product.usaPriceCents != null && (
          <span>EE. UU. {formatCents(product.usaPriceCents)}</span>
        )}
      </p>
    </div>
  );
}

export function ProductCard({ product }: { product: StockProduct }) {
  return (
    <li>
      <Link
        href={`${ROUTES.sellerStock}/${product.id}`}
        prefetch={false}
        className="group flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-surface transition-colors hover:border-border-strong hover:bg-surface-muted active:scale-[0.995]"
      >
        <div className="relative">
          <ProductThumb
            src={product.imageUrl}
            alt={product.name}
            sizes="(min-width: 1024px) 300px, (min-width: 640px) 45vw, 92vw"
            className="aspect-[4/3] w-full"
          />
          {product.category && (
            <span className="absolute left-2.5 top-2.5 rounded-full bg-background/80 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-text-secondary backdrop-blur">
              {product.category}
            </span>
          )}
          <AvailabilityBadge
            availability={product.availability}
            className="absolute right-2.5 top-2.5 bg-background/85 backdrop-blur"
          />
        </div>

        <div className="flex flex-1 flex-col gap-3 p-3.5">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-foreground">{product.name}</h3>
            <p className="truncate text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
              {[product.brand, product.displacement].filter(Boolean).join(" · ") || "—"}
            </p>
          </div>

          <PriceBlock product={product} />

          {product.variants.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                Colores disponibles
              </p>
              <VariantDots variants={product.variants} />
            </div>
          )}

          <span className="mt-auto inline-flex items-center gap-1 pt-1 text-xs font-semibold text-brand">
            Ver detalle
            <ChevronRightIcon size={14} />
          </span>
        </div>
      </Link>
    </li>
  );
}
