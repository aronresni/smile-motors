import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth";
import { ROUTES } from "@/lib/constants";
import { deriveSellerIdentity } from "@/lib/seller/identity";
import { todayISO } from "@/lib/seller/period";
import { getPaymentCatalog } from "@/lib/payments/catalog";
import { CubaSaleForm } from "@/components/seller/ventas/cuba/cuba-sale-form";

export const metadata: Metadata = { title: "Nueva venta (Cuba) · Vendedor" };

export default async function NuevaVentaCubaPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect(ROUTES.login);

  const seller = deriveSellerIdentity(ctx.profile);
  const { methods } = await getPaymentCatalog();

  return (
    <CubaSaleForm
      sellerId={ctx.profile.id}
      sellerName={seller.fullName}
      defaultSaleDate={todayISO()}
      paymentMethods={methods}
    />
  );
}
