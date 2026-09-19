import type { Metadata } from "next";
import { getActivityFeed } from "@/lib/admin/activity";
import { getSellerFilterOptions } from "@/lib/admin/sellers";
import {
  ACTIVITY_PAGE_SIZE,
  parseActivityListSearchParams,
} from "@/lib/admin/activity-list-params";
import { ROUTES } from "@/lib/constants";
import { ActivityToolbar } from "@/components/admin/activity/activity-toolbar";
import { ActivityList } from "@/components/admin/activity/activity-list";
import { ActivityPagination } from "@/components/admin/activity/activity-pagination";

export const metadata: Metadata = { title: "Actividad · Admin" };
export const dynamic = "force-dynamic";

export default async function AdminActividadPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const query = parseActivityListSearchParams(sp);

  const [{ items, total }, sellers] = await Promise.all([
    getActivityFeed({
      category: query.category,
      sellerId: query.sellerId,
      search: query.search || null,
      startDate: query.startDate,
      endDate: query.endDate,
      limit: ACTIVITY_PAGE_SIZE,
      offset: (query.page - 1) * ACTIVITY_PAGE_SIZE,
    }),
    getSellerFilterOptions(),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Actividad</h1>
        <p className="text-sm text-muted-foreground">
          Historial cronológico de acciones en todo el concesionario — ventas, contratos, cobros, aprobaciones,
          vendedores, productos, comisiones, liquidaciones y logística.
        </p>
      </div>

      <ActivityToolbar query={query} sellers={sellers} />

      <ActivityList items={items} />

      <ActivityPagination basePath={ROUTES.adminActividad} query={query} total={total} shownCount={items.length} />
    </div>
  );
}
