import type { Metadata } from "next";
import { requireZone } from "@/lib/auth/session";
import { ROUTES } from "@/lib/constants";
import { getSellerSalesList } from "@/lib/seller/sales-list";
import {
  hasActiveSalesListFilters,
  parseSalesListSearchParams,
} from "@/lib/seller/sales-list-params";
import { NuevaVentaAction } from "@/components/seller/dashboard/nueva-venta-action";
import { SalesListToolbar } from "@/components/seller/ventas/list/sales-list-toolbar";
import { SalesListSummary } from "@/components/seller/ventas/list/sales-list-summary";
import { SalesListResults } from "@/components/seller/ventas/list/sales-list-results";
import { SalesListPagination } from "@/components/seller/ventas/list/sales-list-pagination";
import {
  SalesListEmptyFiltered,
  SalesListEmptyNoSales,
} from "@/components/seller/ventas/list/sales-list-empty";

export const metadata: Metadata = { title: "Mis ventas · Vendedor" };

// Zona protegida + estado en la URL: nunca cachear.
export const dynamic = "force-dynamic";

export default async function SellerVentasPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // Defensa en profundidad (el layout ya valida sesión + rol).
  await requireZone("seller");

  const query = parseSalesListSearchParams(await searchParams);
  const result = await getSellerSalesList(query);

  const filtersActive = hasActiveSalesListFilters(query);
  const isEmpty = result.totalCount === 0;

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">
            Mis ventas
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            Historial de operaciones
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Busca, filtra y abre cualquier venta registrada por ti.
          </p>
        </div>
        <NuevaVentaAction className="sm:shrink-0" />
      </div>

      <SalesListToolbar />

      <SalesListSummary summary={result.summary} />

      {isEmpty ? (
        filtersActive ? (
          <SalesListEmptyFiltered basePath={ROUTES.sellerVentas} />
        ) : (
          <SalesListEmptyNoSales />
        )
      ) : (
        <>
          <SalesListResults items={result.items} />
          <SalesListPagination
            basePath={ROUTES.sellerVentas}
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
