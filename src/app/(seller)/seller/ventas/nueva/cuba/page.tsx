import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth";
import { ROUTES } from "@/lib/constants";
import { deriveSellerIdentity } from "@/lib/seller/identity";
import { todayISO } from "@/lib/seller/period";
import { getPaymentCatalog } from "@/lib/payments/catalog";
import { getSellerProduct } from "@/lib/seller/stock";
import {
  CubaSaleForm,
  type PrefillUnit,
} from "@/components/seller/ventas/cuba/cuba-sale-form";

export const metadata: Metadata = { title: "Nueva venta (Cuba) · Vendedor" };

export default async function NuevaVentaCubaPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect(ROUTES.login);

  const seller = deriveSellerIdentity(ctx.profile);
  const { methods } = await getPaymentCatalog();

  // Producto preseleccionado desde el catálogo ("Crear venta"). El servidor lo
  // vuelve a leer: si dejó de estar activo o no tiene precio configurado, el
  // formulario abre vacío en lugar de arrastrar datos inválidos.
  const sp = await searchParams;
  const first = (v: string | string[] | undefined) =>
    (Array.isArray(v) ? v[0] : (v ?? "")).trim();
  const productId = first(sp.producto);
  const variantId = first(sp.variante);

  let prefillUnit: PrefillUnit | undefined;
  if (productId) {
    const product = await getSellerProduct(productId);
    if (product && product.availability === "DISPONIBLE") {
      const variant = product.variants.find((v) => v.id === variantId) ?? null;
      prefillUnit = {
        catalogModelId: product.id,
        modelName: product.name,
        variantId: variant?.id ?? null,
        variantLabel: variant?.label ?? "",
        listPriceCents: product.cubaPriceCents,
        fixedPriceCents: product.fixedPriceCents,
        fixedCommissionCents: product.fixedCommissionCents,
        agreedPriceCents: product.fixedPriceCents ?? 0,
      };
    }
  }

  return (
    <CubaSaleForm
      sellerId={ctx.profile.id}
      sellerName={seller.fullName}
      defaultSaleDate={todayISO()}
      paymentMethods={methods}
      prefillUnit={prefillUnit}
    />
  );
}
