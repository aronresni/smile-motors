import type { Metadata } from "next";
import Link from "next/link";
import { getAdminSalesList, getActiveSellers } from "@/lib/admin/sales-list";
import {
  hasActiveAdminSalesListFilters,
  parseAdminSalesListSearchParams,
} from "@/lib/admin/sales-list-params";
import { AdminSalesListToolbar } from "@/components/admin/sales/list-toolbar";
import { AdminSalesListResults } from "@/components/admin/sales/list-results";
import { AdminSalesListPagination } from "@/components/admin/sales/list-pagination";

export const metadata: Metadata = { title: "Ventas · Admin" };
export const dynamic = "force-dynamic";

export default async function AdminVentasPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const query = parseAdminSalesListSearchParams(await searchParams);
  const [result, sellers] = await Promise.all([
    getAdminSalesList(query),
    getActiveSellers(),
  ]);

  const filtersActive = hasActiveAdminSalesListFilters(query);
  const isEmpty = result.totalCount === 0;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Ventas</h1>
        <p className="text-sm text-muted-foreground">
          Todas las operaciones, de cualquier vendedor. Busca, filtra y abre
          cualquier venta para revisar o cerrar su cobro.
        </p>
      </div>

      <AdminSalesListToolbar sellers={sellers} />

      {isEmpty ? (
        <div className="rounded-xl border border-dashed px-6 py-14 text-center border-border">
          <p className="text-sm font-medium text-text-secondary">
            {filtersActive ? "No encontramos ventas con estos filtros." : "No hay ventas todavía."}
          </p>
          {filtersActive && (
            <Link
              href="/admin/ventas"
              className="mt-4 inline-flex items-center rounded-md border px-3 py-1.5 text-xs font-medium border-border hover:bg-surface-elevated"
            >
              Limpiar filtros
            </Link>
          )}
        </div>
      ) : (
        <>
          <AdminSalesListResults items={result.items} />
          <AdminSalesListPagination
            basePath="/admin/ventas"
            query={query}
            page={result.page}
            totalPages={result.totalPages}
            totalCount={result.totalCount}
            pageSize={result.pageSize}
            shownCount={result.items.length}
          />
        </>
      )}
    </div>
  );
}
