import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCubaSaleDraft } from "@/app/(seller)/seller/ventas/draft-actions";
import { requireZone } from "@/lib/auth/session";
import { ROUTES } from "@/lib/constants";
import { buildInitialState } from "@/lib/admin/sale-edit-form";
import { getProductsPricing, getSaleCommissionSummary } from "@/lib/sales/commission-summary";
import { AdminSaleEditForm } from "@/components/admin/sale-edit/admin-sale-edit-form";
import { FinancingEditor } from "@/components/sales/financing-editor";
import { getPaymentCatalog } from "@/lib/payments/catalog";
import { editableAllocations } from "@/lib/sales/financing-view";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "Editar venta · Admin" };
export const dynamic = "force-dynamic";

/**
 * Edición / corrección ADMINISTRATIVA directa (sin solicitud de aprobación:
 * el admin no se aprueba a sí mismo). Ruta dedicada — la ficha sigue siendo
 * de solo lectura. Toda la validación, recálculo y auditoría ocurre en
 * `admin_update_cuba_sale`.
 */
export default async function AdminEditSalePage({ params }: { params: Promise<{ saleId: string }> }) {
  const { saleId } = await params;
  await requireZone("admin", `${ROUTES.adminVentas}/${saleId}/editar`);

  const dto = await getCubaSaleDraft(saleId);
  if (!dto || dto.sale.operation_type !== "CUBA") notFound();

  const detailHref = `${ROUTES.adminVentas}/${saleId}`;
  const status = dto.sale.status;

  if (!["DRAFT", "PENDING", "SOLD", "PAID"].includes(status)) {
    return (
      <div className="space-y-4">
        <PageHeader back={{ href: detailHref, label: "Volver a la venta" }} title="Editar venta" />
        <EmptyState title="Esta venta no admite edición." description="Las ventas canceladas no se modifican." />
      </div>
    );
  }

  const [commission, products, catalog] = await Promise.all([
    getSaleCommissionSummary(saleId),
    getProductsPricing(dto.units.map((u) => String(u.product_id ?? ""))),
    getPaymentCatalog(),
  ]);
  // Unidades con comisión congelada: su snapshot rige el mínimo y el recálculo.
  const frozen = Object.fromEntries(
    commission.items.map((c) => [
      c.saleUnitId,
      { fixedPriceCents: c.referencePriceCents, fixedCommissionCents: c.baseCommissionCents },
    ]),
  );
  const initial = buildInitialState(dto, { frozen, products });

  const isPaid = status === "PAID";

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader
        back={{ href: detailHref, label: "Volver a la venta" }}
        eyebrow={isPaid ? "Corrección administrativa" : "Edición administrativa"}
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            {isPaid ? "Corregir" : "Editar"} {dto.sale.sale_number ?? "venta"}
            <StatusBadge domain="sale" status={status} size="md" />
          </span>
        }
        description="Los cambios se aplican directamente (sin solicitud de aprobación), con validación y auditoría completas."
      />
      <AdminSaleEditForm
        saleId={saleId}
        status={status as "DRAFT" | "PENDING" | "SOLD" | "PAID"}
        saleNumber={dto.sale.sale_number}
        sellerName={dto.seller?.fullName ?? "—"}
        expectedUpdatedAt={dto.sale.updated_at ?? null}
        deliveryCents={Number(dto.sale.delivery_total_cents ?? 0)}
        originalTotalCents={Number(dto.sale.sale_total_cents ?? 0) || 0}
        initial={initial}
        detailHref={detailHref}
      />
      {/* Los financiamientos se guardan aparte: tienen sus propias barandillas
          (dinero ya acreditado o cobrado) y su propio motivo, así que un
          bloqueo aquí no deshace la edición comercial de arriba. */}
      <FinancingEditor
        saleId={saleId}
        saleTotalCents={
          Number(dto.sale.sale_total_cents ?? 0) ||
          dto.units.reduce((sum, u) => sum + Number(u.agreed_price_cents ?? 0), 0) +
            Number(dto.sale.delivery_total_cents ?? 0)
        }
        methods={catalog.methods}
        initial={editableAllocations(dto)}
        canVoidContracts
      />
    </div>
  );
}
