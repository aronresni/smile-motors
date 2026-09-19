import type { ReactNode } from "react";
import { formatCents } from "@/lib/money";
import { ROUTES } from "@/lib/constants";
import { SaleStatusBadge } from "@/components/seller/ventas/list/sale-status-badge";
import { LogisticsSection } from "@/components/admin/sale-detail/logistics-section";
import type { SaleUnitLogisticsInfo } from "@/lib/admin/logistics";
import { FinancingContractsSection } from "@/components/seller/ventas/cuba/financing-contracts-section";
import { CommissionSummarySection } from "@/components/seller/ventas/cuba/commission-summary-section";
import type { SaleCommissionView } from "@/lib/sales/commission-summary";
import { SaleChangeHistory } from "@/components/seller/ventas/cuba/sale-change-history";
import { deliveryMethodLabel, type ConfirmedSaleModel } from "@/lib/sales/confirmed-sale";
import type { CubaSaleDraftDto } from "@/lib/sales/draft-transport";
import { PageHeader } from "@/components/ui/page-header";
import { Fact, SectionCard } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  CheckIcon,
  CreditCardIcon,
  MapPinIcon,
  NoteIcon,
  PackageIcon,
  PercentIcon,
  TruckIcon,
  UserIcon,
  XIcon,
} from "@/components/ui/icons";
import { AdminSaleActionPanel } from "@/components/admin/sale-detail/admin-sale-action-panel";
import { SettleDirectPaymentButton } from "@/components/admin/sale-detail/settle-direct-payment-button";
import {
  ReconciliationBanner,
  SaleProcessOverview,
  buildOpsChips,
  commercialSteps,
} from "@/components/admin/sale-detail/sale-process-overview";

function DocPresence({ front, back }: { front: boolean; back: boolean }) {
  const item = (ok: boolean, label: string) => (
    <span className={ok ? "inline-flex items-center gap-1 text-success" : "inline-flex items-center gap-1 text-danger"}>
      {ok ? <CheckIcon size={13} /> : <XIcon size={13} />} {label}
    </span>
  );
  return (
    <div className="flex gap-3 text-xs">
      {item(front, "Frente")}
      {item(back, "Reverso")}
    </div>
  );
}

function Anchor({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div id={id} className="scroll-mt-24">
      {children}
    </div>
  );
}

export function AdminSaleDetailView({
  saleId,
  dto,
  model: m,
  sellerEmail,
  commission,
  logisticsUnits,
  editKinds,
  pendingEditRequestId,
}: {
  saleId: string;
  dto: CubaSaleDraftDto;
  model: ConfirmedSaleModel;
  sellerEmail: string | null;
  commission: SaleCommissionView;
  /** Logística por unidad — ciclo INDEPENDIENTE del estado comercial. */
  logisticsUnits: SaleUnitLogisticsInfo[];
  /** edit_group → edit_kind (origen de cada guardado del historial). */
  editKinds: Record<string, string | null>;
  pendingEditRequestId: string | null;
}) {
  const status = m.status as string;

  // --- derivados (solo presentación; la verdad la re-valida cada RPC) ----
  const financing = m.payments.filter((p) => p.methodType === "FINANCING");
  const fin = {
    total: financing.length,
    accredited: financing.filter((p) => p.financingContract?.status === "ACCREDITED").length,
    signed: financing.filter((p) => p.financingContract?.status === "SIGNED").length,
    sent: financing.filter((p) => p.financingContract?.status === "SENT").length,
    notSent: financing.filter((p) => !p.financingContract).length,
  };
  const unsignedRequired = m.unsignedRequiredProviders;
  const allocatedNet = m.totals.netCoveredCents;
  const saleTotal = m.totals.saleCents;
  const reconciliationRequired =
    ["PENDING", "SOLD", "PAID"].includes(status) &&
    ((m.payments.length > 0 && allocatedNet !== saleTotal) ||
      (["SOLD", "PAID"].includes(status) && m.settlement.amountCollectedCents > saleTotal));

  const chips = buildOpsChips({
    status,
    financing: fin,
    settlement: {
      collectedCents: m.settlement.amountCollectedCents,
      saleTotalCents: saleTotal,
      outstandingCents: m.settlement.amountOutstandingCents,
    },
    // Unidades sin fila logística todavía (antes de VENDIDA) no cuentan.
    logistics: logisticsUnits.map((u) => u.status).filter(Boolean),
  });

  const buyerName = m.buyer.fullName || "Sin comprador";
  const paidBy = dto.statusHistory?.find((h) => h.toStatus === "PAID")?.changedByName ?? null;

  return (
    <div className="space-y-4">
      <PageHeader
        back={{ href: ROUTES.adminVentas, label: "Ventas" }}
        eyebrow="Venta · Cuba"
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            {m.saleNumber ?? "Venta sin número"}
            <SaleStatusBadge status={status} size="md" />
          </span>
        }
        description={`${m.saleDate ?? "Sin fecha"} · ${buyerName} · Vendedor: ${m.sellerName}`}
      />

      <SaleProcessOverview status={status} steps={commercialSteps(m.statusHistory, dto.sale.created_at)} chips={chips} />

      {["PENDING", "SOLD", "PAID"].includes(status) && (
        <ReconciliationBanner
          status={status}
          saleTotalCents={saleTotal}
          allocatedNetCents={m.payments.length > 0 ? allocatedNet : saleTotal}
          collectedCents={m.settlement.amountCollectedCents}
        />
      )}

      {status === "PAID" && (
        <div className="rounded-2xl border border-success/30 bg-success-soft px-4 py-3">
          <p className="text-sm font-semibold text-success">Venta pagada</p>
          <p className="text-xs text-success/80">
            {m.paidAt
              ? new Intl.DateTimeFormat("es-DO", { dateStyle: "medium", timeStyle: "short" }).format(new Date(m.paidAt))
              : null}
            {paidBy ? ` · Confirmado por ${paidBy}` : ""}
          </p>
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* ------------------------------ columna principal ------------------ */}
        <div className="order-2 min-w-0 space-y-4 lg:order-1">
          <SectionCard title="Comprador" icon={<UserIcon size={15} />}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Fact label="Nombre completo" value={m.buyer.fullName} />
              <Fact label="Documento" value={m.buyer.documentNumber} />
              <Fact label="Teléfono" value={m.buyer.phone} />
              <Fact label="Correo" value={m.buyer.email} />
              <Fact label="Dirección" value={m.buyer.addressLine} className="sm:col-span-2" />
            </div>
            <div className="mt-3">
              <DocPresence front={m.buyer.docFront} back={m.buyer.docBack} />
            </div>
            {m.coBuyer && (
              <div className="mt-4 border-t border-border pt-3">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Segundo titular</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Fact label="Nombre" value={m.coBuyer.fullName} />
                  <Fact label="Teléfono" value={m.coBuyer.phone} />
                  <Fact label="Documento" value={m.coBuyer.documentNumber} />
                </div>
                {(m.coBuyer.docFront || m.coBuyer.docBack) && (
                  <div className="mt-3">
                    <DocPresence front={m.coBuyer.docFront} back={m.coBuyer.docBack} />
                  </div>
                )}
              </div>
            )}
            <div className="mt-4 border-t border-border pt-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Vendedor</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Fact label="Nombre" value={m.sellerName} />
                <Fact label="Correo" value={sellerEmail ?? "—"} />
              </div>
            </div>
          </SectionCard>

          <Anchor id="unidades">
            <SectionCard title="Unidades y seguimiento" icon={<PackageIcon size={15} />}>
              <ul className="space-y-2">
                {m.units.map((u, i) => (
                  <li key={u.id} className="rounded-xl border border-border bg-surface-muted px-3 py-2.5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">
                          {i + 1}. {u.productName || "—"}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {[u.brand, u.variant].filter(Boolean).join(" · ") || "Sin variante"} ·{" "}
                          <span className="font-medium text-foreground">{formatCents(u.agreedPriceCents)}</span>
                        </span>
                      </span>
                      <code className="rounded-md border border-border bg-surface px-2 py-1 text-[11px] tabular-nums text-info">
                        {u.trackingCode ?? "Seguimiento al vender"}
                      </code>
                    </div>
                  </li>
                ))}
              </ul>
              {m.extras.length > 0 && (
                <ul className="mt-3 space-y-1 border-t border-border pt-2">
                  {m.extras.map((e, i) => (
                    <li key={i} className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {e.description || "Extra"} ×{e.quantity}
                      </span>
                      <span className="tabular-nums">{formatCents(e.unitPriceCents * e.quantity)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </Anchor>

          <SectionCard title="Destinatario en Cuba y entrega" icon={<MapPinIcon size={15} />}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Fact label="Nombre completo" value={m.recipient.fullName} />
              <Fact label="CI / NI" value={m.recipient.identityNumber} />
              <Fact label="Teléfono principal" value={m.recipient.primaryPhone} />
              <Fact label="Método de entrega" value={deliveryMethodLabel(m.delivery.method)} />
              <Fact
                label="Dirección de entrega"
                value={[m.recipient.deliveryAddress, m.recipient.municipality, m.recipient.province].filter(Boolean).join(", ")}
                className="sm:col-span-2"
              />
            </div>
            <div className="mt-3">
              <DocPresence front={m.recipient.docFront} back={m.recipient.docBack} />
            </div>
          </SectionCard>

          <Anchor id="pagos">
            <SectionCard title="Pagos y cobro" icon={<CreditCardIcon size={15} />}>
              {m.payments.length === 0 ? (
                <p className="text-xs text-muted-foreground">Esta venta no tiene pagos asignados.</p>
              ) : (
                <ul className="space-y-2.5">
                  {m.payments.map((p) => (
                    <li key={p.allocationId} className="rounded-xl border border-border bg-surface-muted px-3 py-2.5 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">
                          {p.providerName}
                          {p.planLabel && <span className="text-muted-foreground"> · {p.planLabel}</span>}
                        </span>
                        {p.methodType === "FINANCING" ? (
                          <StatusBadge domain="contract" status={p.financingContract?.status ?? "NOT_SENT"} size="xs" />
                        ) : (
                          <span className="flex items-center gap-2">
                            <StatusBadge domain="settlement" status={p.settlementStatus} size="xs" />
                            {p.settlementStatus !== "SETTLED" && (status === "PENDING" || status === "SOLD") && (
                              <SettleDirectPaymentButton
                                saleId={saleId}
                                allocationId={p.allocationId}
                                providerName={p.providerName}
                                netCents={p.netCents}
                              />
                            )}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
                        <span>Bruto: {formatCents(p.grossCents)}</span>
                        <span>Fee: {formatCents(p.feeCents)}</span>
                        <span className="font-medium text-text-secondary">Neto: {formatCents(p.netCents)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-[11px] text-muted-foreground">
                Los importes asignados solo cambian mediante los flujos de pago existentes — nunca desde la edición de la
                venta.
              </p>
            </SectionCard>
          </Anchor>

          <Anchor id="contratos">
            <FinancingContractsSection saleId={saleId} sellerId={dto.sale.seller_id} payments={m.payments} isAdmin isOwner={false} />
          </Anchor>

          {(commission.items.length > 0 || commission.estimates.length > 0) && (
            <SectionCard title="Comisión de vendedor" icon={<PercentIcon size={15} />}>
              <CommissionSummarySection
                totalCents={commission.totalCents}
                items={commission.items}
                estimates={commission.estimates}
              />
            </SectionCard>
          )}

          <Anchor id="logistica">
            <SectionCard title="Logística / envío" icon={<TruckIcon size={15} />}>
              <LogisticsSection saleId={saleId} units={logisticsUnits} />
            </SectionCard>
          </Anchor>

          <SectionCard title="Notas internas" icon={<NoteIcon size={15} />}>
            <p className="whitespace-pre-wrap rounded-xl bg-surface-muted px-3 py-2.5 text-sm text-text-secondary">
              {m.internalNotes || "Sin notas."}
            </p>
          </SectionCard>

          <SaleChangeHistory id="historial" entries={dto.changeHistory} editKinds={editKinds} />
        </div>

        {/* ------------------------------ panel de acciones ----------------- */}
        <aside className="order-1 lg:sticky lg:top-24 lg:order-2">
          <AdminSaleActionPanel
            saleId={saleId}
            status={status}
            editHref={`${ROUTES.adminVentas}/${saleId}/editar`}
            saleTotalCents={saleTotal}
            collectedCents={m.settlement.amountCollectedCents}
            outstandingCents={m.settlement.amountOutstandingCents}
            readyForPaid={m.settlement.readyForPaid}
            unsignedRequiredProviders={unsignedRequired}
            hasFinancing={fin.total > 0}
            reconciliationRequired={reconciliationRequired}
            pendingEditRequestHref={pendingEditRequestId ? `${ROUTES.adminAprobaciones}/ediciones/${pendingEditRequestId}` : null}
          />
        </aside>
      </div>
    </div>
  );
}
