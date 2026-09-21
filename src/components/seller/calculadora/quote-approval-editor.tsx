"use client";

import { useMemo, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { MoneyField } from "@/components/ui/money-field";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { PaymentMethodView } from "@/lib/payments/allocation";
import { formatBps } from "@/lib/payments/fee-engine";
import { settleApproval, type QuoteApproval } from "@/lib/sales/quote";

/**
 * Una aprobación SIMULADA: lo que la financiera aprueba en BRUTO, lo que
 * descuenta y lo que realmente entra. No crea contrato ni pago: hasta que la
 * venta exista, esto es una cuenta en papel.
 */
export function QuoteApprovalEditor({
  open,
  method,
  initial,
  suggestedGrossCents,
  buyerState,
  onClose,
  onSave,
}: {
  open: boolean;
  method: PaymentMethodView | null;
  initial?: QuoteApproval | null;
  /** Lo que falta por cubrir — prellena el importe en una aprobación nueva. */
  suggestedGrossCents: number;
  buyerState: string;
  onClose: () => void;
  onSave: (value: QuoteApproval) => void;
}) {
  // El padre remonta con `key`, así que los inicializadores corren frescos.
  const [planId, setPlanId] = useState<string | null>(initial?.planId ?? null);
  const [grossCents, setGrossCents] = useState(
    initial?.grossCents ?? Math.max(0, suggestedGrossCents),
  );

  const isInstallments = method?.feeStrategy === "INSTALLMENTS";

  const draft: QuoteApproval | null = useMemo(() => {
    if (!method) return null;
    const plan = method.plans.find((p) => p.id === planId) ?? null;
    return {
      key: initial?.key ?? "draft",
      paymentMethodId: method.id,
      planId: plan?.id ?? null,
      grossCents,
      methodName: method.name,
      methodType: method.methodType,
      planLabel: plan?.label ?? null,
      termMonths: plan?.termMonths ?? null,
      onlyFlorida: method.onlyFlorida,
    };
  }, [method, planId, grossCents, initial?.key]);

  const settlement = useMemo(
    () => (draft && method ? settleApproval(draft, method, buyerState) : null),
    [draft, method, buyerState],
  );

  if (!method || !draft) return null;

  const canSave =
    grossCents > 0 &&
    !settlement?.floridaBlocked &&
    (!isInstallments || planId != null) &&
    settlement?.error == null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={method.name}
      description={
        method.methodType === "FINANCING"
          ? "Importe aprobado por la financiera (bruto)."
          : "Importe que paga el cliente."
      }
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!canSave}
            onClick={() =>
              onSave({ ...draft, key: initial?.key ?? crypto.randomUUID() })
            }
          >
            {initial ? "Guardar cambios" : "Agregar"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {settlement?.floridaBlocked && (
          <p
            role="alert"
            className="rounded-lg border border-danger/30 bg-danger-surface px-3 py-2 text-xs text-danger"
          >
            Esta financiera solo está disponible para clientes de Florida (FL).
          </p>
        )}

        {isInstallments && (
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium text-text-secondary">
              Plazo <span className="text-danger">*</span>
            </legend>
            {method.plans.length === 0 ? (
              <p className="text-xs text-danger">
                Esta financiera no tiene plazos configurados. Pídele a Administración
                que los cargue.
              </p>
            ) : (
              <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {method.plans.map((p) => {
                  const active = planId === p.id;
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        aria-pressed={active}
                        onClick={() => setPlanId(p.id)}
                        className={cn(
                          "w-full rounded-xl border px-2 py-2 text-center transition-colors",
                          active
                            ? "border-brand bg-brand-soft"
                            : "border-border bg-surface-muted hover:border-border-strong",
                        )}
                      >
                        <span className="block text-[11px] font-bold uppercase tracking-[0.08em] text-foreground">
                          {p.label}
                        </span>
                        {/* Es el descuento del proveedor al concesionario, NO el interés del cliente. */}
                        <span className="block text-[10px] tabular-nums text-muted-foreground">
                          descuenta {formatBps(p.feeBps)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </fieldset>
        )}

        <MoneyField
          label={
            method.methodType === "FINANCING" ? "Aprobado (bruto)" : "Paga el cliente"
          }
          valueCents={grossCents}
          onChangeCents={setGrossCents}
          required
        />

        {settlement && (
          <dl className="space-y-1 rounded-xl border border-border bg-surface-muted/50 px-3 py-2.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Aprobado (bruto)</dt>
              <dd className="tabular-nums text-text-secondary">
                {formatCents(settlement.grossCents)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">
                {method.methodType === "FINANCING" ? "Te quita la financiera" : "Comisión"}
              </dt>
              <dd className="tabular-nums text-danger">
                −{formatCents(settlement.feeCents)}
              </dd>
            </div>
            <div className="flex justify-between border-t border-border pt-1">
              <dt className="font-medium text-foreground">Neto líquido</dt>
              <dd className="tabular-nums font-semibold text-success">
                {formatCents(settlement.netCents)}
              </dd>
            </div>
            {settlement.monthlyCents != null && (
              <div className="flex justify-between pt-1 text-xs">
                <dt className="text-muted-foreground">Cuota mensual estimada</dt>
                <dd className="tabular-nums text-text-secondary">
                  {formatCents(settlement.monthlyCents)}
                </dd>
              </div>
            )}
            {settlement.error && (
              <p className="pt-1 text-[11px] text-danger">{settlement.error}</p>
            )}
          </dl>
        )}

        {method.requiresSignedContract && (
          <p className="rounded-lg bg-surface-muted px-3 py-1.5 text-[11px] text-muted-foreground">
            En la venta real esta financiera exige contrato firmado. Aquí es solo una
            simulación.
          </p>
        )}
      </div>
    </Modal>
  );
}
