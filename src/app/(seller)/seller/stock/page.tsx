import type { Metadata } from "next";
import Link from "next/link";
import { ROUTES } from "@/lib/constants";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { CalculatorIcon } from "@/components/ui/icons";
import { getSellerCatalog } from "@/lib/seller/stock";
import {
  hasActiveStockFilters,
  parseStockListSearchParams,
} from "@/lib/seller/stock-params";
import { StockToolbar } from "@/components/seller/stock/stock-toolbar";
import { ProductCard } from "@/components/seller/stock/product-card";

export const metadata: Metadata = { title: "Stock · Vendedor" };

/**
 * STOCK = CATÁLOGO DE LO QUE SE PUEDE VENDER HOY.
 *
 * En la navegación se llama "Stock" porque es la palabra del vendedor, pero
 * no hay inventario físico detrás: ni VIN, ni cantidades, ni reservas. Solo
 * lectura — el catálogo lo gobierna Administración.
 */
export default async function SellerStockPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const query = parseStockListSearchParams(await searchParams);
  const { products, categories, brands } = await getSellerCatalog(query);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Stock"
        description="Todo lo que Smile Motors vende hoy. Precios y colores los define Administración."
        actions={
          <Link href={ROUTES.sellerCalculadora}>
            <Button variant="secondary" size="sm" icon={<CalculatorIcon size={15} />}>
              Calculadora
            </Button>
          </Link>
        }
      />

      <StockToolbar query={query} categories={categories} brands={brands} />

      {products.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface/60 px-5 py-12 text-center">
          <p className="text-sm text-text-secondary">
            No encontramos productos con estos filtros.
          </p>
          {hasActiveStockFilters(query) && (
            <Link
              href={ROUTES.sellerStock}
              className="mt-3 inline-flex text-xs font-semibold text-brand hover:opacity-80"
            >
              Ver todo el catálogo
            </Link>
          )}
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {products.length === 1 ? "1 producto" : `${products.length} productos`}
          </p>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
