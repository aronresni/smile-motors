import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ROUTES } from "@/lib/constants";
import { formatCents } from "@/lib/money";
import { PageHeader } from "@/components/ui/page-header";
import { getSellerProduct } from "@/lib/seller/stock";
import { ProductGallery } from "@/components/seller/stock/product-gallery";
import { ProductActions } from "@/components/seller/stock/product-actions";
import { AvailabilityBadge } from "@/components/seller/stock/product-card";

export const metadata: Metadata = { title: "Producto · Vendedor" };

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-2.5">
      <dt className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

export default async function SellerStockProductPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  const product = await getSellerProduct(productId);
  if (!product) notFound();

  // Especificaciones: solo las que el catálogo tiene guardadas de verdad.
  const specs: { label: string; value: string }[] = [
    { label: "Marca", value: product.brand },
    { label: "Categoría", value: product.category },
    { label: "Cilindrada", value: product.displacement },
    { label: "Motor", value: product.engine ?? "" },
    { label: "Potencia", value: product.power ?? "" },
    { label: "Peso", value: product.weight ?? "" },
  ].filter((s) => s.value.trim() !== "");

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={product.category || undefined}
        title={product.name}
        description={[product.brand, product.displacement].filter(Boolean).join(" · ")}
        back={{ href: ROUTES.sellerStock, label: "Stock" }}
        actions={<AvailabilityBadge availability={product.availability} />}
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <ProductGallery images={product.images} alt={product.name} />

        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-surface p-4">
            <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Precio de venta (mínimo oficial)
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums leading-none text-brand">
              {product.fixedPriceCents != null
                ? formatCents(product.fixedPriceCents)
                : "Sin configurar"}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Puedes vender por encima; nunca por debajo.
            </p>

            <dl className="mt-3 grid grid-cols-2 gap-2">
              {product.cubaPriceCents != null && (
                <Fact label="Precio Cuba" value={formatCents(product.cubaPriceCents)} />
              )}
              {product.usaPriceCents != null && (
                <Fact label="Precio EE. UU." value={formatCents(product.usaPriceCents)} />
              )}
              {product.shippingCents != null && product.shippingCents > 0 && (
                <Fact label="Envío de referencia" value={formatCents(product.shippingCents)} />
              )}
            </dl>
          </div>

          {product.fixedCommissionCents != null && (
            <div className="rounded-2xl border border-border bg-surface p-4">
              <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                Tu comisión
              </p>
              <p className="mt-1 text-xl font-semibold tabular-nums leading-none text-success">
                {formatCents(product.fixedCommissionCents)}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Más la mitad de cada dólar que vendas por encima del precio mínimo. La
                comisión definitiva se congela cuando la venta queda VENDIDA.
              </p>
            </div>
          )}

          <ProductActions product={product} />
        </div>
      </div>

      {specs.length > 0 && (
        <section>
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Ficha técnica
          </h2>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {specs.map((s) => (
              <Fact key={s.label} label={s.label} value={s.value} />
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}
