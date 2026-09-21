import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth";
import { ROUTES } from "@/lib/constants";
import { getCubaSaleDraft } from "@/app/(seller)/seller/ventas/draft-actions";
import { getLatestSaleEditRequest } from "@/lib/seller/edit-requests";
import { SaleEditRequestForm, type UnitPricingMap } from "@/components/seller/ventas/cuba/sale-edit-request-form";
import { getProductsPricing, getSaleCommissionSummary } from "@/lib/sales/commission-summary";
import { FinancingEditor } from "@/components/sales/financing-editor";
import { getPaymentCatalog } from "@/lib/payments/catalog";
import { editableAllocations } from "@/lib/sales/financing-view";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Solicitar edición · Vendedor" };
export const dynamic = "force-dynamic";

export default async function EditarVentaPage({
  params,
}: {
  params: Promise<{ saleId: string }>;
}) {
  const { saleId } = await params;

  const ctx = await getAuthContext();
  if (!ctx) redirect(ROUTES.login);

  // getCubaSaleDraft aplica RLS: solo devuelve la venta si es del vendedor.
  const dto = await getCubaSaleDraft(saleId);
  if (!dto || dto.sale.operation_type !== "CUBA") notFound();

  const detailHref = `${ROUTES.sellerVentas}/${saleId}`;

  // DRAFT sigue editándose libremente en el formulario normal — esta
  // pantalla es solo para SOLICITAR una edición de PENDING/SOLD.
  if (dto.sale.status === "DRAFT") {
    redirect(detailHref);
  }
  // PAID: corrección administrativa excepcional, todavía no implementada
  // en esta fase — nunca una edición normal del vendedor.
  if (dto.sale.status === "PAID") {
    redirect(detailHref);
  }
  if (dto.sale.status !== "PENDING" && dto.sale.status !== "SOLD") {
    redirect(detailHref);
  }

  // Como máximo una solicitud PENDING por venta: si ya hay una, se muestra
  // su estado en vez de abrir el editor (el vendedor nunca crea una
  // segunda en conflicto).
  const existing = await getLatestSaleEditRequest(saleId);
  if (existing && existing.status === "PENDING") {
    return (
      <div className="mx-auto max-w-lg space-y-4 py-10 text-center">
        <div className="rounded-2xl border border-warning/40 bg-warning/10 px-5 py-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-warning">
            Edición pendiente de aprobación
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Ya enviaste una solicitud de edición para esta venta el{" "}
            {new Intl.DateTimeFormat("es-DO", { dateStyle: "medium", timeStyle: "short" }).format(
              new Date(existing.createdAt),
            )}
            . Un administrador debe revisarla antes de que puedas enviar otra.
          </p>
          <p className="mt-3 rounded-lg bg-surface px-3 py-2 text-left text-xs text-foreground">
            <span className="font-semibold">Motivo: </span>
            {existing.reason}
          </p>
        </div>
        <Link href={detailHref}>
          <Button variant="secondary">Volver a la venta</Button>
        </Link>
      </div>
    );
  }

  // Mínimo de cada unidad: el precio fijo CONGELADO si ya tiene comisión
  // (VENDIDA); si no, el vigente del producto.
  const [commission, products, catalog] = await Promise.all([
    getSaleCommissionSummary(saleId),
    getProductsPricing(dto.units.map((u) => String(u.product_id ?? ""))),
    getPaymentCatalog(),
  ]);
  const pricing: UnitPricingMap = {};
  for (const u of dto.units) {
    const unitId = String(u.id);
    const frozen = commission.items.find((c) => c.saleUnitId === unitId);
    const product = products[String(u.product_id ?? "")];
    pricing[unitId] = frozen
      ? { fixedPriceCents: frozen.referencePriceCents, fixedCommissionCents: frozen.baseCommissionCents, frozen: true }
      : { fixedPriceCents: product?.fixedPriceCents ?? null, fixedCommissionCents: product?.fixedCommissionCents ?? null, frozen: false };
  }

  return (
    <div className="space-y-4">
      <SaleEditRequestForm saleId={saleId} dto={dto} pricing={pricing} />
      {/* Los pagos se corrigen directamente (no van por aprobación): la base
          bloquea por sí sola lo que ya tiene dinero dentro o contrato
          emitido, y anular un contrato es cosa de administración. */}
      <FinancingEditor
        saleId={saleId}
        saleTotalCents={
          Number(dto.sale.sale_total_cents ?? 0) ||
          dto.units.reduce((sum, u) => sum + Number(u.agreed_price_cents ?? 0), 0) +
            Number(dto.sale.delivery_total_cents ?? 0)
        }
        methods={catalog.methods}
        initial={editableAllocations(dto)}
        canVoidContracts={false}
      />
    </div>
  );
}
