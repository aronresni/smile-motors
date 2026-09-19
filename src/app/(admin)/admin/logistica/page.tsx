import type { Metadata } from "next";
import { getLogisticsKpis, getLogisticsList } from "@/lib/admin/logistics";
import { getSellerFilterOptions } from "@/lib/admin/sellers";
import { LOGISTICS_LIST_PAGE_SIZE, parseLogisticsListSearchParams } from "@/lib/admin/logistics-list-params";
import { LogisticsKpiCards } from "@/components/admin/logistics/logistics-kpis";
import { LogisticsToolbar } from "@/components/admin/logistics/logistics-toolbar";
import { LogisticsListResults } from "@/components/admin/logistics/logistics-list-results";

export const metadata: Metadata = { title: "Logística · Admin" };
export const dynamic = "force-dynamic";

export default async function AdminLogisticaPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const query = parseLogisticsListSearchParams(sp);

  const [kpis, { items, total }, sellers] = await Promise.all([
    getLogisticsKpis(),
    getLogisticsList({
      status: query.status,
      commercialStatus: query.commercialStatus,
      sellerId: query.sellerId,
      search: query.search || null,
      limit: LOGISTICS_LIST_PAGE_SIZE,
      offset: (query.page - 1) * LOGISTICS_LIST_PAGE_SIZE,
    }),
    getSellerFilterOptions(),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Logística</h1>
        <p className="text-sm text-muted-foreground">
          Ciclo operativo de envío por unidad — independiente del estado comercial de la venta. Marcar SOLD/PAID
          nunca cambia esto, ni al revés.
        </p>
      </div>

      <LogisticsKpiCards kpis={kpis} />
      <LogisticsToolbar query={query} sellers={sellers} />
      <LogisticsListResults items={items} />

      {items.length > 0 && (
        <p className="text-center text-[11px] text-muted-foreground">Mostrando {items.length} de {total}</p>
      )}
    </div>
  );
}
