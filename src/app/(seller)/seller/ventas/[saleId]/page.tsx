import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth";
import { ROLES, ROUTES } from "@/lib/constants";
import { deriveSellerIdentity } from "@/lib/seller/identity";
import { todayISO } from "@/lib/seller/period";
import { getPaymentCatalog } from "@/lib/payments/catalog";
import { getCubaSaleDraft } from "@/app/(seller)/seller/ventas/draft-actions";
import { CubaSaleForm } from "@/components/seller/ventas/cuba/cuba-sale-form";
import { ConfirmedSaleView } from "@/components/seller/ventas/cuba/confirmed-sale-view";
import { getLatestSaleEditRequest } from "@/lib/seller/edit-requests";
import { getSaleCommissionSummary } from "@/lib/sales/commission-summary";
import { getSaleUnitLogisticsStatus } from "@/lib/admin/logistics";

export const metadata: Metadata = { title: "Venta · Vendedor" };

export default async function SaleDraftPage({
  params,
}: {
  params: Promise<{ saleId: string }>;
}) {
  const { saleId } = await params;

  const ctx = await getAuthContext();
  if (!ctx) redirect(ROUTES.login);

  // getCubaSaleDraft aplica RLS: solo devuelve la venta si es del vendedor (o admin).
  const draft = await getCubaSaleDraft(saleId);
  if (!draft || draft.sale.operation_type !== "CUBA") notFound();

  const seller = deriveSellerIdentity(ctx.profile);
  const sellerName = draft.seller?.fullName ?? seller.fullName;
  const isAdmin = ctx.profile.role === ROLES.ADMIN;
  const isOwner = draft.sale.seller_id === ctx.profile.id;

  // Ficha operativa de solo lectura (con acciones según rol) para todo lo
  // que ya salió de edición libre del vendedor.
  if (
    draft.sale.status === "PENDING" ||
    draft.sale.status === "SOLD" ||
    draft.sale.status === "PAID"
  ) {
    const latestEditRequest = await getLatestSaleEditRequest(saleId);
    const commission = await getSaleCommissionSummary(saleId);
    const logisticsUnits = await getSaleUnitLogisticsStatus(saleId);

    return (
      <ConfirmedSaleView
        saleId={saleId}
        dto={draft}
        sellerName={sellerName}
        status={draft.sale.status}
        isAdmin={isAdmin}
        isOwner={isOwner}
        latestEditRequest={latestEditRequest}
        commission={commission}
        logisticsUnits={logisticsUnits}
      />
    );
  }

  const { methods } = await getPaymentCatalog();

  return (
    <CubaSaleForm
      sellerId={ctx.profile.id}
      sellerName={seller.fullName}
      defaultSaleDate={draft.sale.sale_date ?? todayISO()}
      paymentMethods={methods}
      initialSaleId={saleId}
      initialDraft={draft}
    />
  );
}
