import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth";
import { ROUTES } from "@/lib/constants";
import { deriveSellerIdentity } from "@/lib/seller/identity";
import { getCubaSaleDraft } from "@/app/(seller)/seller/ventas/draft-actions";
import { SaleReview } from "@/components/seller/ventas/cuba/sale-review";
import { getSaleCommissionSummary } from "@/lib/sales/commission-summary";

export const metadata: Metadata = { title: "Revisión de venta · Vendedor" };

export default async function RevisionPage({
  params,
}: {
  params: Promise<{ saleId: string }>;
}) {
  const { saleId } = await params;

  const ctx = await getAuthContext();
  if (!ctx) redirect(ROUTES.login);

  const dto = await getCubaSaleDraft(saleId);
  if (!dto || dto.sale.operation_type !== "CUBA") notFound();

  // La revisión previa (preview) solo tiene sentido mientras la venta es un
  // borrador editable; para PENDING/SOLD/PAID, la ficha ya vive en la ruta base.
  if (dto.sale.status !== "DRAFT") {
    redirect(`${ROUTES.sellerVentas}/${saleId}`);
  }

  const sellerName =
    dto.seller?.fullName ?? deriveSellerIdentity(ctx.profile).fullName;

  // Comisión estimada ANTES de enviar (configuración vigente de cada producto).
  const commission = await getSaleCommissionSummary(saleId);

  return <SaleReview saleId={saleId} dto={dto} sellerName={sellerName} commission={commission} />;
}
