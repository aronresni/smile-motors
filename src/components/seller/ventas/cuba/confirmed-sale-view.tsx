"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ROUTES } from "@/lib/constants";
import { DEALER } from "@/config/dealer";
import { formatCents } from "@/lib/money";
import { buttonClasses } from "@/components/ui/button";
import {
  CopyButton,
  ShareActions,
} from "@/components/seller/ventas/share-actions";
import { SaleChangeHistory } from "@/components/seller/ventas/cuba/sale-change-history";
import { SaleStatusBadge } from "@/components/seller/ventas/list/sale-status-badge";
import { SaleCommercialTimeline } from "@/components/seller/ventas/cuba/sale-commercial-timeline";
import { ProcessStepper } from "@/components/ui/process-stepper";
import { commercialSteps } from "@/lib/sales/process";
import { AdminReviewActions } from "@/components/seller/ventas/cuba/admin-review-actions";
import { MarkSaleSoldAction } from "@/components/seller/ventas/cuba/mark-sale-sold-action";
import { ClosingReviewActions } from "@/components/seller/ventas/cuba/closing-review-actions";
import { FinancingContractsSection } from "@/components/seller/ventas/cuba/financing-contracts-section";
import { CommissionSummarySection } from "@/components/seller/ventas/cuba/commission-summary-section";
import type { SaleCommissionView } from "@/lib/sales/commission-summary";
import { LogisticsTimelineSection } from "@/components/seller/ventas/cuba/logistics-timeline-section";
import type { SaleUnitLogisticsInfo } from "@/lib/sales/logistics-types";
import type { SaleEditRequestStatus } from "@/lib/seller/edit-requests";
import {
  buildConfirmedSaleModel,
  deliveryMethodLabel,
  generateCommercialSummary,
  generateCubaShippingMessage,
} from "@/lib/sales/confirmed-sale";
import type { CubaSaleDraftDto } from "@/lib/sales/draft-transport";

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <h2 className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {icon} {title}
      </h2>
      {children}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-foreground">{value || "—"}</p>
    </div>
  );
}

const HEADING: Record<string, { eyebrow: string; hint: string }> = {
  PENDING: {
    eyebrow: "Venta en revisión",
    hint: "Pendiente · se marca como vendida cuando los contratos obligatorios están firmados.",
  },
  SOLD: {
    eyebrow: "Venta vendida",
    hint: "Operación comercial cerrada · el cobro puede seguir pendiente (ver abajo).",
  },
  PAID: {
    eyebrow: "Venta pagada",
    hint: "Liquidación completa y confirmada por un administrador.",
  },
};

export function ConfirmedSaleView({
  saleId,
  dto,
  sellerName,
  status,
  isAdmin,
  isOwner,
  latestEditRequest = null,
  commission = { totalCents: 0, items: [], estimates: [] },
  logisticsUnits = [],
}: {
  saleId: string;
  dto: CubaSaleDraftDto;
  sellerName: string;
  /** Estado operativo de la venta en este momento: PENDING | SOLD | PAID. */
  status: "PENDING" | "SOLD" | "PAID";
  isAdmin: boolean;
  isOwner: boolean;
  /** Última solicitud de edición de esta venta, si existe. */
  latestEditRequest?: SaleEditRequestStatus | null;
  commission?: SaleCommissionView;
  /** Logística de solo lectura — el vendedor nunca puede mutarla. */
  logisticsUnits?: SaleUnitLogisticsInfo[];
}) {
  const m = buildConfirmedSaleModel(dto, sellerName);
  const commercial = generateCommercialSummary(m);
  const shipping = generateCubaShippingMessage(m, DEALER);
  const detailHref = `${ROUTES.sellerVentas}/${saleId}`;
  const editHref = `${detailHref}/editar`;
  const heading = HEADING[status] ?? HEADING.SOLD;

  // Aviso tras una edición correcta (lo deja el formulario de edición).
  const [updatedFlash, setUpdatedFlash] = useState(false);
  useEffect(() => {
    let hideTimer: number | undefined;
    // La lectura + setState van diferidas fuera del cuerpo del efecto.
    const readTimer = window.setTimeout(() => {
      try {
        const key = `sale-updated:${saleId}`;
        if (sessionStorage.getItem(key) === null) return;
        sessionStorage.removeItem(key);
        setUpdatedFlash(true);
        hideTimer = window.setTimeout(() => setUpdatedFlash(false), 4000);
      } catch {
        /* sessionStorage no disponible */
      }
    }, 0);
    return () => {
      window.clearTimeout(readTimer);
      if (hideTimer) window.clearTimeout(hideTimer);
    };
  }, [saleId]);

  return (
    <div className="print-area mx-auto max-w-3xl space-y-5">
      {updatedFlash && (
        <div
          role="status"
          className="no-print rounded-xl border border-success/30 bg-success/10 px-4 py-2.5 text-sm font-medium text-success"
        >
          Venta actualizada correctamente.
        </div>
      )}

      {/* ---- encabezado ---- */}
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">
            {heading.eyebrow}
          </p>
          <SaleStatusBadge status={status} />
        </div>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          {m.saleNumber ?? "Venta pendiente de número"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{heading.hint}</p>
      </div>

      {/* ---- proceso comercial (mismo stepper que Admin) ---- */}
      <div className="no-print rounded-2xl border border-border bg-surface p-4">
        <ProcessStepper steps={commercialSteps(m.statusHistory)} currentKey={status} ariaLabel="Proceso comercial de la venta" />
      </div>

      {status === "PAID" && (
        <div className="no-print rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-sm font-medium text-success">
          ✓ Operación totalmente liquidada.
          {m.paidAt && (
            <span className="block font-normal text-success/80">
              Fecha de pago:{" "}
              {new Intl.DateTimeFormat("es-DO", {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(m.paidAt))}
            </span>
          )}
        </div>
      )}

      {/* ---- estado de venta / estado de cobro (separados) ---- */}
      {(status === "SOLD" || status === "PAID") && (
        <div className="no-print grid grid-cols-2 gap-3 rounded-2xl border border-border bg-surface p-4 text-sm">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Estado de venta
            </p>
            <p className="mt-0.5 font-medium text-foreground">
              {status === "PAID" ? "Pagada" : "Vendida"}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Estado de cobro
            </p>
            <p className="mt-0.5 font-medium text-foreground">
              {m.settlement.status === "PAID"
                ? "Pagado"
                : m.settlement.closingReviewedAt
                  ? "Cobro en revisión"
                  : "Pendiente a cobrar"}
            </p>
          </div>
        </div>
      )}

      {/* ---- acción del vendedor: cerrar venta (solo PENDING, dueño) ---- */}
      {isOwner && status === "PENDING" && (
        <div className="no-print">
          <MarkSaleSoldAction
            saleId={saleId}
            unsignedRequiredProviders={m.unsignedRequiredProviders}
          />
        </div>
      )}

      {/* ---- acciones de administrador: revisión PENDING / cierre SOLD ---- */}
      {isAdmin && status === "PENDING" && (
        <div className="no-print">
          <AdminReviewActions saleId={saleId} />
        </div>
      )}
      {isAdmin && status === "SOLD" && (
        <div className="no-print">
          <ClosingReviewActions saleId={saleId} settlement={m.settlement} />
        </div>
      )}

      {/* ---- línea de tiempo comercial ---- */}
      {m.statusHistory.length > 0 && (
        <Section title="Progreso de la venta" icon="🕒">
          <SaleCommercialTimeline history={m.statusHistory} />
        </Section>
      )}

      {/* ---- resumen principal ---- */}
      <Section title="Resumen" icon="🧾">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Fact label="N.º de venta" value={m.saleNumber ?? "Pendiente"} />
          <Fact label="Fecha" value={m.saleDate ?? "—"} />
          <Fact label="Vendedor" value={m.sellerName} />
          <Fact label="Cliente" value={m.buyer.fullName} />
          <Fact label="Unidades" value={String(m.units.length)} />
          <Fact label="Total" value={formatCents(m.totals.saleCents)} />
          {status === "PENDING" && m.reviewRequestedAt && (
            <Fact
              label="Enviada a revisión"
              value={new Intl.DateTimeFormat("es-DO", {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(m.reviewRequestedAt))}
            />
          )}
        </div>
        <p className="mt-3 rounded-lg bg-surface-muted px-3 py-2 text-[11px] text-muted-foreground">
          Comisión pendiente — el cálculo autoritativo se implementa por
          separado.
        </p>
      </Section>

      {/* ---- unidades + tracking ---- */}
      <Section title="Unidades y seguimiento" icon="📦">
        <ul className="space-y-2">
          {m.units.map((u, i) => (
            <li
              key={u.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-muted/50 px-3 py-2.5"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-foreground">
                  {i + 1}. {u.productName || "—"}
                </span>
                <span className="block text-[11px] text-muted-foreground">
                  {[u.brand, u.variant].filter(Boolean).join(" · ")} ·{" "}
                  {formatCents(u.agreedPriceCents)}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <code className="rounded-md border border-border bg-surface px-2 py-1 text-[11px] tabular-nums text-accent">
                  {u.trackingCode ?? "Pendiente"}
                </code>
                {u.trackingCode && (
                  <CopyButton text={u.trackingCode} label="Copiar" />
                )}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      {/* ---- logística / envío (solo lectura) ---- */}
      {logisticsUnits.length > 0 && (
        <Section title="Logística / Envío" icon="🛳️">
          <LogisticsTimelineSection units={logisticsUnits} />
        </Section>
      )}

      {/* ---- destino Cuba ---- */}
      <Section title="Destino en Cuba" icon="🚚">
        <div className="grid grid-cols-2 gap-3">
          <Fact label="Destinatario" value={m.recipient.fullName} />
          <Fact label="CI" value={m.recipient.identityNumber} />
          <Fact label="Teléfono" value={m.recipient.primaryPhone} />
          <Fact
            label="Método"
            value={deliveryMethodLabel(m.delivery.method)}
          />
          <div className="col-span-2">
            <Fact
              label="Dirección de entrega"
              value={[
                m.recipient.deliveryAddress,
                m.recipient.municipality,
                m.recipient.province,
              ]
                .filter(Boolean)
                .join(", ")}
            />
          </div>
        </div>
      </Section>

      {/* ---- contratos de financiación ---- */}
      <div className="no-print">
        <FinancingContractsSection
          saleId={saleId}
          sellerId={dto.sale.seller_id}
          payments={m.payments}
          isAdmin={isAdmin}
          isOwner={isOwner}
        />
      </div>

      {/* ---- tu comisión ---- */}
      {(commission.items.length > 0 || commission.estimates.length > 0) && (
        <Section title={commission.items.length > 0 ? "Tu comisión" : "Tu comisión estimada"} icon="🧾">
          <CommissionSummarySection
            totalCents={commission.totalCents}
            items={commission.items}
            estimates={commission.estimates}
            isSeller
          />
        </Section>
      )}

      {/* ---- liquidación / métodos de pago ---- */}
      <Section title="Liquidación y pagos" icon="💳">
        <ul className="space-y-2">
          {m.payments.map((p) => (
            <li
              key={p.allocationId}
              className="rounded-xl bg-surface-muted/50 px-3 py-2.5 text-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-foreground">
                  {p.providerName}
                  {p.planLabel ? (
                    <span className="text-muted-foreground"> · {p.planLabel}</span>
                  ) : null}
                </span>
                <span className="tabular-nums font-semibold text-foreground">
                  {formatCents(p.netCents)}
                </span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
                <span>Bruto: {formatCents(p.grossCents)}</span>
                <span>Fee: {formatCents(p.feeCents)}</span>
                <span>Neto: {formatCents(p.netCents)}</span>
                {p.methodType !== "FINANCING" && (
                  <span
                    className={
                      p.settlementStatus === "SETTLED"
                        ? "font-medium text-success"
                        : ""
                    }
                  >
                    {p.settlementStatus === "SETTLED"
                      ? "✓ Liquidado"
                      : "Pendiente de liquidar"}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex items-center justify-between border-t border-border pt-2 text-sm">
          <span className="text-muted-foreground">Total neto acreditado</span>
          <span className="tabular-nums font-semibold text-foreground">
            {formatCents(m.totals.netCoveredCents)}
          </span>
        </div>
      </Section>

      {/* ---- mensajes generados ---- */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-surface p-4">
          <h2 className="mb-2 text-sm font-semibold text-foreground">
            Resumen comercial
          </h2>
          <pre className="mb-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-muted p-3 text-[11px] leading-relaxed text-text-secondary">
            {commercial}
          </pre>
          <div className="no-print">
            <ShareActions text={commercial} />
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4">
          <h2 className="mb-2 text-sm font-semibold text-foreground">
            Datos de envío a Cuba
          </h2>
          <pre className="mb-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-muted p-3 text-[11px] leading-relaxed text-text-secondary">
            {shipping}
          </pre>
          <div className="no-print">
            <ShareActions text={shipping} />
          </div>
        </div>
      </div>

      {/* ---- solicitud de edición ---- */}
      {latestEditRequest?.status === "PENDING" && (
        <div className="no-print rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-warning">
            Edición pendiente de aprobación
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Solicitada:{" "}
            {new Intl.DateTimeFormat("es-DO", { dateStyle: "medium", timeStyle: "short" }).format(
              new Date(latestEditRequest.createdAt),
            )}
          </p>
          <p className="mt-1 text-xs text-foreground">{latestEditRequest.reason}</p>
        </div>
      )}
      {latestEditRequest?.status === "APPROVED" && (
        <div className="no-print rounded-2xl border border-success/30 bg-success/10 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-success">Edición aprobada</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Aprobada:{" "}
            {latestEditRequest.reviewedAt
              ? new Intl.DateTimeFormat("es-DO", { dateStyle: "medium", timeStyle: "short" }).format(
                  new Date(latestEditRequest.reviewedAt),
                )
              : "—"}
          </p>
        </div>
      )}
      {latestEditRequest?.status === "REJECTED" && (
        <div className="no-print rounded-2xl border border-danger/30 bg-danger-surface px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-danger">Edición rechazada</p>
          <p className="mt-1 text-xs text-foreground">
            <span className="font-semibold">Motivo: </span>
            {latestEditRequest.reviewNote ?? "—"}
          </p>
        </div>
      )}

      {/* ---- historial de cambios ---- */}
      <SaleChangeHistory entries={dto.changeHistory} />

      {/* ---- acciones ---- */}
      <div className="no-print flex flex-wrap gap-2">
        {(status === "SOLD" || status === "PENDING") && latestEditRequest?.status !== "PENDING" && (
          <Link href={editHref} className={buttonClasses("primary", "md")}>
            Solicitar edición
          </Link>
        )}
        {status === "PAID" && (
          <p className="w-full text-xs text-muted-foreground">
            Las ventas pagadas requieren una corrección administrativa.
          </p>
        )}
        <button
          type="button"
          onClick={() => window.print()}
          className={buttonClasses("secondary", "md")}
        >
          Imprimir
        </button>
      </div>
    </div>
  );
}
