"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/lib/constants";
import { formatCents, multiplyCents } from "@/lib/money";
import { buttonClasses, Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  buildConfirmedSaleModel,
  deliveryMethodLabel,
} from "@/lib/sales/confirmed-sale";
import type { CubaSaleDraftDto } from "@/lib/sales/draft-transport";
import {
  confirmErrorSection,
  confirmErrorText,
} from "@/lib/sales/confirm-errors";
import { requestSaleReview } from "@/app/(seller)/seller/ventas/draft-actions";
import { toast } from "@/components/ui/toast";
import type { SaleCommissionView } from "@/lib/sales/commission-summary";
import { CommissionSummarySection } from "@/components/seller/ventas/cuba/commission-summary-section";

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right text-foreground">{value || "—"}</span>
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <h2 className="mb-2 text-sm font-semibold text-foreground">{title}</h2>
      {children}
    </div>
  );
}

const docFlag = (front: boolean, back: boolean) =>
  front && back
    ? "Frente y reverso cargados"
    : front
      ? "Solo el frente"
      : back
        ? "Solo el reverso"
        : "Sin documentos";

export function SaleReview({
  saleId,
  dto,
  sellerName,
  commission,
}: {
  saleId: string;
  dto: CubaSaleDraftDto;
  sellerName: string;
  commission?: SaleCommissionView;
}) {
  const router = useRouter();
  const m = buildConfirmedSaleModel(dto, sellerName);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorCodes, setErrorCodes] = useState<string[]>([]);

  const editHref = `${ROUTES.sellerVentas}/${saleId}`;
  const firstErrorSection =
    errorCodes.map(confirmErrorSection).find(Boolean) ?? null;

  const settlementIncomplete = m.totals.saleCents !== m.totals.netCoveredCents;

  const submitReview = async () => {
    if (submitting) return;
    setSubmitting(true);
    setErrorCodes([]);
    const res = await requestSaleReview(saleId);
    if (res.ok) {
      toast.success("Venta enviada a revisión.", "Queda pendiente hasta que la cierres o la revise administración.");
      router.replace(editHref);
      return;
    }
    setConfirmOpen(false);
    setErrorCodes(res.errors?.length ? res.errors : [res.code]);
    setSubmitting(false);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">
          Revisión
        </p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          Revisa la venta antes de enviarla
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Estos son los datos <strong>guardados</strong> en el sistema. Al
          solicitar revisión, la venta queda <strong>pendiente</strong> hasta
          que un administrador la apruebe (o la devuelva para corrección).
        </p>
      </div>

      <Block title="Vendedor">
        <Line label="Nombre" value={m.sellerName} />
      </Block>

      <Block title="Comprador">
        <Line label="Nombre" value={m.buyer.fullName} />
        <Line label="Teléfono" value={m.buyer.phone} />
        <Line label="Correo" value={m.buyer.email} />
        <Line label="ID / licencia" value={m.buyer.documentNumber} />
        <Line label="Dirección" value={m.buyer.addressLine} />
        <Line
          label="Documentos"
          value={docFlag(m.buyer.docFront, m.buyer.docBack)}
        />
      </Block>

      {m.coBuyer && (
        <Block title="Co-buyer">
          <Line label="Nombre" value={m.coBuyer.fullName} />
          <Line label="Teléfono" value={m.coBuyer.phone} />
          <Line label="Correo" value={m.coBuyer.email} />
        </Block>
      )}

      <Block title={`Unidades (${m.units.length})`}>
        {m.units.length === 0 && (
          <p className="py-2 text-xs text-danger">Sin unidades.</p>
        )}
        {m.units.map((u, i) => (
          <div key={u.id} className="border-b border-border/60 py-2 last:border-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-foreground">
                {i + 1}. {u.productName || "Sin modelo"}
                {u.brand ? ` · ${u.brand}` : ""}
              </span>
              <span className="text-sm font-semibold tabular-nums text-foreground">
                {formatCents(u.agreedPriceCents)}
              </span>
            </div>
            <div className="mt-1 grid gap-0.5 text-xs text-muted-foreground">
              {u.variant && <span>Color: {u.variant}</span>}
              <span>
                Catálogo (lista):{" "}
                {u.listPriceCentsSnapshot != null
                  ? formatCents(u.listPriceCentsSnapshot)
                  : "—"}{" "}
                · (Cuba):{" "}
                {u.cubaTotalCentsSnapshot != null
                  ? formatCents(u.cubaTotalCentsSnapshot)
                  : "—"}
              </span>
              <span>Precio de venta: {formatCents(u.agreedPriceCents)}</span>
            </div>
          </div>
        ))}
        {m.extras.length > 0 && (
          <div className="mt-3 border-t border-border pt-2">
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Extras
            </p>
            {m.extras.map((e, i) => (
              <Line
                key={i}
                label={`${e.description || "Extra"} × ${e.quantity}`}
                value={formatCents(multiplyCents(e.unitPriceCents, e.quantity))}
              />
            ))}
          </div>
        )}
      </Block>

      {commission && commission.estimates.length > 0 && (
        <Block title="Tu comisión estimada">
          <CommissionSummarySection
            totalCents={commission.totalCents}
            items={commission.items}
            estimates={commission.estimates}
            isSeller
          />
        </Block>
      )}

      <Block title="Destinatario en Cuba">
        <Line label="Nombre" value={m.recipient.fullName} />
        <Line label="CI" value={m.recipient.identityNumber} />
        <Line label="Dirección de entrega" value={m.recipient.deliveryAddress} />
        <Line label="Municipio" value={m.recipient.municipality} />
        <Line label="Provincia" value={m.recipient.province} />
        <Line label="Teléfono principal" value={m.recipient.primaryPhone} />
        <Line label="Teléfono secundario" value={m.recipient.secondaryPhone} />
        <Line
          label="Documentos"
          value={docFlag(m.recipient.docFront, m.recipient.docBack)}
        />
      </Block>

      <Block title="Entrega y notas">
        <Line label="Método" value={deliveryMethodLabel(m.delivery.method)} />
        {m.delivery.method === "PICKUP_POINT" && (
          <Line label="Punto de recogida" value={m.delivery.pickupReference} />
        )}
        <Line label="Notas internas" value={m.internalNotes} />
      </Block>

      <Block title="Precio">
        <Line
          label="Subtotal unidades"
          value={formatCents(m.totals.unitsCents)}
        />
        <Line label="Extras" value={formatCents(m.totals.extrasCents)} />
        <Line label="Entrega" value={formatCents(m.totals.deliveryCents)} />
        <div className="mt-1 border-t border-border pt-1">
          <Line label="Total de la venta" value={formatCents(m.totals.saleCents)} />
        </div>
      </Block>

      <Block title="Liquidación y pagos">
        {m.payments.length === 0 ? (
          <p className="py-2 text-xs text-danger">Sin métodos de pago.</p>
        ) : (
          m.payments.map((p, i) => (
            <div
              key={i}
              className="border-b border-border/60 py-2 last:border-0"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-foreground">
                  {p.providerName}
                  {p.planLabel ? ` · ${p.planLabel}` : ""}
                </span>
                <span className="text-sm font-semibold tabular-nums text-foreground">
                  {formatCents(p.netCents)}
                </span>
              </div>
              <div className="mt-0.5 grid gap-0.5 text-xs text-muted-foreground">
                <span>Bruto: {formatCents(p.grossCents)}</span>
                <span>Fee: {formatCents(p.feeCents)}</span>
                <span>Neto acreditado: {formatCents(p.netCents)}</span>
              </div>
            </div>
          ))
        )}
        <div className="mt-2 border-t border-border pt-2">
          <Line
            label="Total neto acreditado"
            value={formatCents(m.totals.netCoveredCents)}
          />
          <Line
            label="Restante"
            value={formatCents(m.totals.saleCents - m.totals.netCoveredCents)}
          />
        </div>
        <Line label="Comisión" value="Pendiente de cálculo" />
      </Block>

      {errorCodes.length > 0 && (
        <div
          role="alert"
          className="space-y-1 rounded-2xl border border-danger/30 bg-danger-surface p-4 text-sm text-danger"
        >
          <p className="font-semibold">No se pudo enviar la venta a revisión:</p>
          <ul className="list-inside list-disc space-y-0.5">
            {errorCodes.map((c) => (
              <li key={c}>{confirmErrorText(c)}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Link
          href={
            firstErrorSection
              ? `${editHref}#${firstErrorSection}`
              : editHref
          }
          className={buttonClasses("secondary", "md", "sm:mr-auto")}
        >
          ← Volver al editor
        </Link>
        <Button
          variant="primary"
          onClick={() => setConfirmOpen(true)}
          disabled={submitting || settlementIncomplete}
        >
          {settlementIncomplete ? "Liquidación incompleta" : "Solicitar revisión"}
        </Button>
      </div>

      <Modal
        open={confirmOpen}
        onClose={() => !submitting && setConfirmOpen(false)}
        title="Enviar a revisión"
        description="Al enviar la venta a revisión dejarás de editarla hasta que sea aprobada o devuelta para corrección."
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setConfirmOpen(false)}
              disabled={submitting}
            >
              Cancelar
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void submitReview()}
              disabled={submitting}
            >
              {submitting ? "Enviando a revisión…" : "Enviar a revisión"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-text-secondary">
          Total de la venta: <strong>{formatCents(m.totals.saleCents)}</strong>{" "}
          · Neto acreditado: <strong>{formatCents(m.totals.netCoveredCents)}</strong>
        </p>
      </Modal>
    </div>
  );
}
