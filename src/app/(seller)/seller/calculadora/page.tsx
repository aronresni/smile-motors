import type { Metadata } from "next";
import Link from "next/link";
import { ROUTES } from "@/lib/constants";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { BoxesIcon } from "@/components/ui/icons";
import { getPaymentCatalog } from "@/lib/payments/catalog";
import { getSellerProduct } from "@/lib/seller/stock";
import type { QuoteLine } from "@/lib/sales/quote";
import { QuoteCalculator } from "@/components/seller/calculadora/quote-calculator";

export const metadata: Metadata = { title: "Calculadora · Vendedor" };

/**
 * Herramienta de planificación del vendedor. El producto puede llegar
 * preseleccionado desde el catálogo (`?producto=…&variante=…`); el servidor lo
 * vuelve a leer y solo lo acepta si sigue activo.
 */
export default async function SellerCalculadoraPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const first = (v: string | string[] | undefined) =>
    (Array.isArray(v) ? v[0] : (v ?? "")).trim();

  const productId = first(sp.producto);
  const variantId = first(sp.variante);

  const { methods } = await getPaymentCatalog();

  let initialLine: QuoteLine | null = null;
  if (productId) {
    const product = await getSellerProduct(productId);
    if (product && product.availability === "DISPONIBLE") {
      const variant = product.variants.find((v) => v.id === variantId) ?? null;
      initialLine = {
        key: `pre-${product.id}-${variant?.id ?? "sin-color"}`,
        productId: product.id,
        variantId: variant?.id ?? null,
        productName: product.name,
        variantLabel: variant?.label ?? null,
        listPriceCents: product.cubaPriceCents,
        fixedPriceCents: product.fixedPriceCents,
        fixedCommissionCents: product.fixedCommissionCents,
        imageUrl: product.imageUrl,
        agreedPriceCents: product.fixedPriceCents ?? 0,
      };
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Calculadora"
        description="Simula la venta antes de cerrarla: qué aprueba cada financiera, qué descuenta y cuánto dinero entra de verdad."
        actions={
          <Link href={ROUTES.sellerStock}>
            <Button variant="secondary" size="sm" icon={<BoxesIcon size={15} />}>
              Stock
            </Button>
          </Link>
        }
      />

      <QuoteCalculator methods={methods} initialLine={initialLine} />
    </div>
  );
}
