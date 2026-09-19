import type { Metadata } from "next";
import { getAdminProductList } from "@/lib/admin/products";
import {
  STATUS_TO_DB,
  hasActiveProductFilters,
  parseProductListSearchParams,
} from "@/lib/admin/product-list-params";
import { CreateProductModal } from "@/components/admin/products/product-form";
import { ProductListToolbar } from "@/components/admin/products/product-list-toolbar";
import { ProductListResults } from "@/components/admin/products/product-list-results";

export const metadata: Metadata = { title: "Productos · Admin" };
export const dynamic = "force-dynamic";

export default async function AdminProductosPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const query = parseProductListSearchParams(sp);
  const autoOpen = (Array.isArray(sp.nuevo) ? sp.nuevo[0] : sp.nuevo) === "1";
  const { items, categories } = await getAdminProductList({
    search: query.search,
    status: STATUS_TO_DB[query.status],
    category: query.category,
  });

  const filtersActive = hasActiveProductFilters(query);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Productos</h1>
          <p className="text-sm text-muted-foreground">
            Catálogo de motos y equipos. Los cambios nunca afectan ventas ya registradas.
          </p>
        </div>
        <CreateProductModal defaultOpen={autoOpen} />
      </div>

      <ProductListToolbar categories={categories} />

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed px-6 py-14 text-center border-border">
          <p className="text-sm font-medium text-text-secondary">
            {filtersActive ? "No encontramos productos con estos filtros." : "No hay productos configurados."}
          </p>
          {!filtersActive && (
            <div className="mt-4 flex justify-center">
              <CreateProductModal />
            </div>
          )}
        </div>
      ) : (
        <ProductListResults items={items} />
      )}
    </div>
  );
}
