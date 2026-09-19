import type { Metadata } from "next";
import { getAdminProviderList } from "@/lib/admin/financing";
import {
  CONTRACT_TO_DB,
  STATUS_TO_DB,
  TYPE_TO_DB,
  hasActiveFinancingFilters,
  parseFinancingListSearchParams,
} from "@/lib/admin/financing-list-params";
import { CreateProviderModal } from "@/components/admin/financing/provider-form";
import { FinancingListToolbar } from "@/components/admin/financing/financing-list-toolbar";
import { FinancingListResults } from "@/components/admin/financing/financing-list-results";

export const metadata: Metadata = { title: "Financieras · Admin" };
export const dynamic = "force-dynamic";

export default async function AdminFinancierasPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const query = parseFinancingListSearchParams(await searchParams);
  const items = await getAdminProviderList({
    search: query.search,
    type: TYPE_TO_DB[query.type],
    status: STATUS_TO_DB[query.status],
    contract: CONTRACT_TO_DB[query.contract],
  });

  const filtersActive = hasActiveFinancingFilters(query);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Financieras</h1>
          <p className="text-sm text-muted-foreground">
            Métodos de pago y financiación disponibles para ventas nuevas. Los cambios nunca afectan ventas ya
            registradas.
          </p>
        </div>
        <CreateProviderModal />
      </div>

      <FinancingListToolbar />

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed px-6 py-14 text-center border-border">
          <p className="text-sm font-medium text-text-secondary">
            {filtersActive ? "No encontramos financieras con estos filtros." : "No hay financieras configuradas."}
          </p>
          {!filtersActive && (
            <div className="mt-4 flex justify-center">
              <CreateProviderModal />
            </div>
          )}
        </div>
      ) : (
        <FinancingListResults items={items} />
      )}
    </div>
  );
}
