import type { Metadata } from "next";
import { getAlertsList, getAlertsSummary } from "@/lib/admin/alerts";
import { getSellerFilterOptions } from "@/lib/admin/sellers";
import { ALERTS_PAGE_SIZE, parseAlertsListSearchParams } from "@/lib/admin/alerts-list-params";
import { ROUTES } from "@/lib/constants";
import { AlertsSummaryCards } from "@/components/admin/alerts/alerts-summary-cards";
import { AlertsToolbar } from "@/components/admin/alerts/alerts-toolbar";
import { AlertsList } from "@/components/admin/alerts/alerts-list";
import { AlertsPagination } from "@/components/admin/alerts/alerts-pagination";

export const metadata: Metadata = { title: "Alertas · Admin" };
export const dynamic = "force-dynamic";

export default async function AdminAlertasPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const query = parseAlertsListSearchParams(sp);

  const [summary, { items, total }, sellers] = await Promise.all([
    getAlertsSummary(),
    getAlertsList({
      category: query.category,
      priority: query.priority,
      sellerId: query.sellerId,
      limit: ALERTS_PAGE_SIZE,
      offset: (query.page - 1) * ALERTS_PAGE_SIZE,
    }),
    getSellerFilterOptions(),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Alertas</h1>
        <p className="text-sm text-muted-foreground">
          Condiciones actuales que requieren atención — derivadas del estado real de cada venta, contrato,
          liquidación y logística. Desaparecen solas cuando la condición se resuelve.
        </p>
      </div>

      <AlertsSummaryCards summary={summary} />
      <AlertsToolbar query={query} sellers={sellers} />
      <AlertsList items={items} />
      <AlertsPagination basePath={ROUTES.adminAlertas} query={query} total={total} shownCount={items.length} />
    </div>
  );
}
