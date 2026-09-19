import type { Metadata } from "next";
import { getAdminSellerList } from "@/lib/admin/sellers";
import {
  STATUS_TO_DB,
  hasActiveSellerFilters,
  parseSellerListSearchParams,
} from "@/lib/admin/seller-list-params";
import { ROUTES } from "@/lib/constants";
import { InviteSellerModal } from "@/components/admin/sellers/invite-seller-modal";
import { SellerListToolbar } from "@/components/admin/sellers/seller-list-toolbar";
import { SellerListResults } from "@/components/admin/sellers/seller-list-results";
import { SellerListPagination } from "@/components/admin/sellers/seller-list-pagination";

export const metadata: Metadata = { title: "Vendedores · Admin" };
export const dynamic = "force-dynamic";

export default async function AdminVendedoresPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const query = parseSellerListSearchParams(sp);
  const autoOpen = (Array.isArray(sp.nuevo) ? sp.nuevo[0] : sp.nuevo) === "1";
  const result = await getAdminSellerList(query.search, STATUS_TO_DB[query.status], query.page);

  const filtersActive = hasActiveSellerFilters(query);
  const isEmpty = result.totalCount === 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Vendedores</h1>
          <p className="text-sm text-muted-foreground">
            Invita vendedores, gestiona su acceso y revisa su desempeño comercial.
          </p>
        </div>
        <InviteSellerModal defaultOpen={autoOpen} />
      </div>

      <SellerListToolbar />

      {isEmpty ? (
        <div className="rounded-xl border border-dashed px-6 py-14 text-center border-border">
          <p className="text-sm font-medium text-text-secondary">
            {filtersActive ? "No encontramos vendedores con estos filtros." : "No hay vendedores."}
          </p>
          {!filtersActive && (
            <div className="mt-4 flex justify-center">
              <InviteSellerModal />
            </div>
          )}
        </div>
      ) : (
        <>
          <SellerListResults items={result.items} />
          <SellerListPagination
            basePath={ROUTES.adminVendedores}
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
