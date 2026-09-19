"use client";

import { useMemo, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { MoneyField } from "@/components/ui/money-field";
import { TextField } from "@/components/ui/form-fields";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  buildFeeConfig,
  settleAllocation,
  type AllocationFormValue,
  type PaymentMethodView,
} from "@/lib/payments/allocation";
import { feeStrategySummary, formatBps } from "@/lib/payments/fee-engine";

interface Props {
  open: boolean;
  method: PaymentMethodView | null;
  /** Valor a editar (si se está editando una allocation existente). */
  initial?: AllocationFormValue | null;
  /** Neto que falta por cubrir — se usa para prellenar el importe. */
  suggestedNetCents?: number;
  buyerState: string;
  onClose: () => void;
  onSave: (value: AllocationFormValue) => void;
}

export function PaymentAllocationEditor({
  open,
  method,
  initial,
  suggestedNetCents = 0,
  buyerState,
  onClose,
  onSave,
}: Props) {
  // El padre remonta este componente (prop `key`) por cada objetivo de edición,
  // así que los inicializadores de estado corren frescos cada vez.
  const [planId, setPlanId] = useState<string | null>(initial?.planId ?? null);
  const [inputMode, setInputMode] = useState<"GROSS" | "NET">(
    initial?.inputMode ?? "NET",
  );
  const [amountCents, setAmountCents] = useState(
    initial?.amountCents ?? Math.max(0, suggestedNetCents),
  );
  const [reference, setReference] = useState(initial?.reference ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");

  const isInstallments = method?.feeStrategy === "INSTALLMENTS";
  const showModeToggle = method != null && method.feeStrategy !== "NONE";

  const settlement = useMemo(() => {
    if (!method) return null;
    return settleAllocation({ inputMode, amountCents, planId }, method);
  }, [method, inputMode, amountCents, planId]);

  const floridaBlocked =
    method?.onlyFlorida === true && buyerState.toUpperCase() !== "FL";

  const planFeeBps = useMemo(() => {
    if (!method || planId == null) return null;
    return method.plans.find((p) => p.id === planId)?.feeBps ?? null;
  }, [method, planId]);

  const canSave =
    method != null &&
    amountCents > 0 &&
    !floridaBlocked &&
    (!isInstallments || planId != null) &&
    (settlement?.error == null);

  const save = () => {
    if (!method || !canSave) return;
    const value: AllocationFormValue = {
      key: initial?.key ?? crypto.randomUUID(),
      id: initial?.id ?? null,
      paymentMethodId: method.id,
      planId: isInstallments ? planId : null,
      inputMode,
      amountCents,
      reference: reference.trim(),
      notes: notes.trim(),
      methodName: method.name,
      methodType: method.methodType,
      feeStrategy: method.feeStrategy,
      onlyFlorida: method.onlyFlorida,
      planLabel: isInstallments
        ? (method.plans.find((p) => p.id === planId)?.label ?? null)
        : null,
    };
    onSave(value);
  };

  if (!method) return null;

  const cfg = buildFeeConfig(method, planFeeBps);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={method.name}
      description={feeStrategySummary(cfg)}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" size="sm" onClick={save} disabled={!canSave}>
            {initial ? "Guardar cambios" : "Agregar pago"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {method.requiresSignedContract && (
          <p className="rounded-lg bg-surface-muted px-3 py-1.5 text-[11px] text-muted-foreground">
            Requiere contrato firmado (se gestiona en la operación de financiación).
          </p>
        )}

        {floridaBlocked && (
          <p
            role="alert"
            className="rounded-lg border border-danger/30 bg-danger-surface px-3 py-2 text-xs text-danger"
          >
            Esta financiera solo está disponible para clientes de Florida (FL).
          </p>
        )}

        {isInstallments && (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-text-secondary">
              Plazo <span className="text-danger">*</span>
            </span>
            {method.plans.length === 0 ? (
              <p className="text-xs text-danger">
                Esta financiera no tiene plazos configurados.
              </p>
            ) : (
              <select
                value={planId ?? ""}
                onChange={(e) => setPlanId(e.target.value || null)}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                <option value="">Selecciona el plazo…</option>
                {method.plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} · comisión {formatBps(p.feeBps)}
                  </option>
                ))}
              </select>
            )}
          </label>
        )}

        {showModeToggle && (
          <div className="flex gap-1 rounded-lg bg-surface-muted p-1 text-xs font-semibold">
            {(["GROSS", "NET"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setInputMode(m)}
                className={cn(
                  "flex-1 rounded-md px-3 py-1.5 transition-colors",
                  inputMode === m
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m === "GROSS" ? "Ingresar BRUTO" : "Ingresar NETO"}
              </button>
            ))}
          </div>
        )}

        <MoneyField
          label={
            inputMode === "GROSS"
              ? "Bruto (importe procesado por el proveedor)"
              : "Neto acreditado deseado"
          }
          valueCents={amountCents}
          onChangeCents={setAmountCents}
        />

        {settlement && (
          <dl className="space-y-1 rounded-lg border border-border bg-surface-muted/50 px-3 py-2.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Bruto</dt>
              <dd className="tabular-nums text-text-secondary">
                {formatCents(settlement.grossCents)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">
                Fee{planFeeBps != null ? ` (${formatBps(planFeeBps)})` : ""}
              </dt>
              <dd className="tabular-nums text-danger">
                −{formatCents(settlement.feeCents)}
              </dd>
            </div>
            <div className="flex justify-between border-t border-border pt-1">
              <dt className="font-medium text-foreground">Neto acreditado</dt>
              <dd className="tabular-nums font-semibold text-foreground">
                {formatCents(settlement.netCents)}
              </dd>
            </div>
            {settlement.error && (
              <p className="pt-1 text-[11px] text-danger">{settlement.error}</p>
            )}
          </dl>
        )}

        <TextField
          label="Referencia / confirmación (opcional)"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />
        <TextField
          label="Notas (opcional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        {method.methodType === "CARD" && (
          <p className="rounded-lg bg-surface-muted px-3 py-1.5 text-[11px] text-muted-foreground">
            No se capturan número de tarjeta ni CVV. Solo se registra la
            asignación comercial del pago.
          </p>
        )}
      </div>
    </Modal>
  );
}
