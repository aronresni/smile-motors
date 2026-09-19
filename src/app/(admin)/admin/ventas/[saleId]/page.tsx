import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAuthContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getCubaSaleDraft } from "@/app/(seller)/seller/ventas/draft-actions";
import { buildConfirmedSaleModel } from "@/lib/sales/confirmed-sale";
import { AdminSaleDetailView } from "@/components/admin/sale-detail/admin-sale-detail-view";
import { getSaleCommissionSummary } from "@/lib/sales/commission-summary";
import { getSaleUnitLogisticsStatus } from "@/lib/admin/logistics";
import { getLatestSaleEditRequest } from "@/lib/seller/edit-requests";

export const metadata: Metadata = { title: "Venta · Admin" };
export const dynamic = "force-dynamic";

/** Centro de control operativo de UNA venta (Admin). */
export default async function AdminSaleDetailPage({
  params,
}: {
  params: Promise<{ saleId: string }>;
}) {
  const { saleId } = await params;

  // El layout de /admin ya exige rol admin (requireZone); este guard extra
  // solo tipa `ctx` como no-nulo (nunca se confía en un rol leído del cliente).
  const ctx = await getAuthContext();
  if (!ctx) notFound();

  // getCubaSaleDraft aplica RLS: para un admin devuelve CUALQUIER venta
  // (misma fuente de datos que usa el vendedor — nunca se duplica).
  const draft = await getCubaSaleDraft(saleId);
  if (!draft || draft.sale.operation_type !== "CUBA") notFound();

  const model = buildConfirmedSaleModel(draft, draft.seller?.fullName ?? "—");
  const supabase = await createClient();

  const [commission, logisticsUnits, latestRequest, kindsRes] = await Promise.all([
    getSaleCommissionSummary(saleId),
    getSaleUnitLogisticsStatus(saleId),
    getLatestSaleEditRequest(saleId),
    supabase.from("sale_change_history").select("edit_group, edit_kind").eq("sale_id", saleId),
  ]);

  // Origen de cada guardado del historial (edición admin / corrección /
  // solicitud aprobada). Si la columna aún no existe, simplemente no se etiqueta.
  const editKinds: Record<string, string | null> = {};
  for (const row of kindsRes.error ? [] : (kindsRes.data ?? [])) {
    if (row.edit_kind && !editKinds[row.edit_group]) editKinds[row.edit_group] = row.edit_kind;
  }

  return (
    <AdminSaleDetailView
      saleId={saleId}
      dto={draft}
      model={model}
      sellerEmail={draft.seller?.email ?? null}
      commission={commission}
      logisticsUnits={logisticsUnits}
      editKinds={editKinds}
      pendingEditRequestId={latestRequest?.status === "PENDING" ? latestRequest.id : null}
    />
  );
}
