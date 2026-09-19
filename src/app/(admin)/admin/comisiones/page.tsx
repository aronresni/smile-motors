import type { Metadata } from "next";
import { getCommissionKpis, getCommissionList } from "@/lib/admin/commissions";
import {
  STATUS_TO_DB,
  COMMISSION_LIST_PAGE_SIZE,
  hasActiveCommissionFilters,
  parseCommissionListSearchParams,
} from "@/lib/admin/commissions-list-params";
import { CommissionKpiCards } from "@/components/admin/commissions/commission-kpis";
import { CommissionListToolbar } from "@/components/admin/commissions/commission-list-toolbar";
import { CommissionListResults } from "@/components/admin/commissions/commission-list-results";

export const metadata: Metadata = { title: "Comisiones · Admin" };
export const dynamic = "force-dynamic";

export default async function AdminComisionesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const query = parseCommissionListSearchParams(sp);

  const [kpis, { items, total }] = await Promise.all([
    getCommissionKpis(),
    getCommissionList({
      search: query.search,
      status: STATUS_TO_DB[query.status],
      sellerId: query.sellerId,
      productId: null,
      startDate: null,
      endDate: null,
      limit: COMMISSION_LIST_PAGE_SIZE,
      offset: (query.page - 1) * COMMISSION_LIST_PAGE_SIZE,
    }),
  ]);

  const filtersActive = hasActiveCommissionFilters(query);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Comisiones</h1>
        <p className="text-sm text-muted-foreground">
          Comisión de vendedor por unidad vendida. Calculada una vez al pasar a VENDIDA; nunca recalculada desde
          configuración actual salvo una edición de venta ya aprobada.
        </p>
      </div>

      <CommissionKpiCards kpis={kpis} />
      <CommissionListToolbar query={query} />

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed px-6 py-14 text-center border-border">
          <p className="text-sm font-medium text-text-secondary">
            {filtersActive ? "No encontramos comisiones con estos filtros." : "Todavía no hay comisiones calculadas."}
          </p>
        </div>
      ) : (
        <>
          <CommissionListResults items={items} />
          <p className="text-center text-[11px] text-muted-foreground">
            Mostrando {items.length} de {total}
          </p>
        </>
      )}
    </div>
  );
}
