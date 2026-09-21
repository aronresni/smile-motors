"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MoneyField } from "@/components/ui/money-field";
import { toast } from "@/components/ui/toast";
import { formatCents } from "@/lib/money";
import type { PaymentMethodView } from "@/lib/payments/allocation";
import {
  saveSalePaymentAllocations,
  type AllocationInput,
  type BlockedAllocation,
} from "@/lib/sales/financing-actions";

export interface EditableAllocation {
  id: string | null;
  paymentMethodId: string;
  planId: string | null;
  inputMode: "GROSS" | "NET";
  amountCents: number;
  reference: string;
  notes: string;
  /** Estado del dinero de esta asignación (solo informativo). */
  lock?: "ACCREDITED" | "SETTLED" | "SIGNED" | "SENT" | null;
}

interface Row extends EditableAllocation {
  key: string;
  voidContract?: boolean;
}

const LOCK_LABEL: Record<string, string> = {
  ACCREDITED: "Acreditado",
  SETTLED: "Cobrado",
  SIGNED: "Contrato firmado",
  SENT: "Contrato enviado",
};

/**
 * Financiamientos y pagos de una venta, editables.
 *
 * Toda la autoridad está en `set_sale_payment_allocations`: aquí solo se
 * arma lo que se quiere guardar y se explica lo que la base devuelva
 * bloqueado. El dinero que ya entró no se cambia desde esta pantalla — se
 * deshace primero, a propósito.
 */
export function FinancingEditor({
  saleId,
  saleTotalCents,
  methods,
  initial,
  canVoidContracts,
}: {
  saleId: string;
  saleTotalCents: number;
  methods: PaymentMethodView[];
  initial: EditableAllocation[];
  /** Administración puede anular un contrato ya emitido. */
  canVoidContracts: boolean;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    initial.map((a, i) => ({ ...a, key: a.id ?? `new-${i}` })),
  );
  const [reason, setReason] = useState("");
  const [blocked, setBlocked] = useState<BlockedAllocation[]>([]);
  const [saving, setSaving] = useState(false);

  const byId = useMemo(() => new Map(methods.map((m) => [m.id, m])), [methods]);
  const allocated = rows.reduce((sum, r) => sum + (r.amountCents || 0), 0);
  const difference = allocated - saleTotalCents;
  const dirty = useMemo(
    () => JSON.stringify(rows.map(strip)) !== JSON.stringify(initial.map(strip)),
    [rows, initial],
  );

  const patch = (key: string, next: Partial<Row>) =>
    setRows((list) => list.map((r) => (r.key === key ? { ...r, ...next } : r)));

  const add = () =>
    setRows((list) => [
      ...list,
      {
        key: `new-${Date.now()}`,
        id: null,
        paymentMethodId: methods[0]?.id ?? "",
        planId: null,
        inputMode: "NET",
        amountCents: Math.max(0, saleTotalCents - allocated),
        reference: "",
        notes: "",
      },
    ]);

  const save = async () => {
    if (saving) return;
    if (reason.trim().length < 3) {
      toast.error("Escribe el motivo del cambio.");
      return;
    }
    setSaving(true);
    setBlocked([]);
    try {
      const payload: AllocationInput[] = rows.map((r) => ({
        id: r.id,
        paymentMethodId: r.paymentMethodId,
        planId: r.planId,
        inputMode: r.inputMode,
        amountCents: r.amountCents,
        reference: r.reference,
        notes: r.notes,
        voidContract: r.voidContract,
      }));
      const result = await saveSalePaymentAllocations({ saleId, allocations: payload, reason });
      if (!result.ok) {
        if (result.blocked?.length) {
          setBlocked(result.blocked);
          toast.error("No se guardó nada: hay pagos bloqueados.");
        } else {
          toast.error(errorMessage(result.code));
        }
        return;
      }
      setBlocked([]);
      setReason("");
      toast.success(
        "Financiamientos actualizados.",
        result.contractsVoided ? `${result.contractsVoided} contrato(s) anulado(s).` : undefined,
      );
    } catch {
      toast.error("No pudimos guardar los financiamientos.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Financiamientos y pagos</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Cómo se cobra esta venta. Lo que ya entró (acreditado o cobrado) se deshace primero.
          </p>
        </div>
        <div className="text-right text-xs">
          <p className="text-muted-foreground">
            Asignado <span className="font-semibold text-foreground">{formatCents(allocated)}</span> de{" "}
            {formatCents(saleTotalCents)}
          </p>
          {difference !== 0 && (
            <p className="font-semibold text-warning">
              {difference > 0 ? "Sobran " : "Faltan "}
              {formatCents(Math.abs(difference))}
            </p>
          )}
        </div>
      </div>

      {blocked.length > 0 && (
        <div role="alert" className="space-y-2 rounded-xl border border-danger/30 bg-danger-surface p-3">
          <p className="text-xs font-semibold text-danger">
            No se guardó ningún cambio. Estos pagos están bloqueados:
          </p>
          <ul className="space-y-1.5 text-xs text-text-secondary">
            {blocked.map((b) => (
              <li key={b.allocationId}>
                · {blockedMessage(b, rows, byId, canVoidContracts)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-3">
        {rows.map((row) => {
          const method = byId.get(row.paymentMethodId);
          const plans = method?.plans ?? [];
          const locked = row.lock === "ACCREDITED" || row.lock === "SETTLED";
          const emitted = row.lock === "SENT" || row.lock === "SIGNED";
          return (
            <div key={row.key} className="space-y-2 rounded-xl border border-border bg-surface-muted p-3">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="Método de pago"
                  value={row.paymentMethodId}
                  disabled={locked}
                  onChange={(e) => patch(row.key, { paymentMethodId: e.target.value, planId: null })}
                  className="min-h-9 flex-1 rounded-lg border border-border-strong bg-surface px-2 text-xs text-foreground disabled:opacity-60"
                >
                  {methods.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                {plans.length > 0 && (
                  <select
                    aria-label="Plan"
                    value={row.planId ?? ""}
                    disabled={locked}
                    onChange={(e) => patch(row.key, { planId: e.target.value || null })}
                    className="min-h-9 flex-1 rounded-lg border border-border-strong bg-surface px-2 text-xs text-foreground disabled:opacity-60"
                  >
                    <option value="">Sin plan</option>
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                )}
                {row.lock && (
                  <span className="rounded-full border border-border-strong px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
                    {LOCK_LABEL[row.lock] ?? row.lock}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-end gap-2">
                <div className="w-40">
                  <MoneyField
                    label="Importe"
                    valueCents={row.amountCents}
                    onChangeCents={(cents) => patch(row.key, { amountCents: cents ?? 0 })}
                    disabled={locked}
                  />
                </div>
                <select
                  aria-label="Modo del importe"
                  value={row.inputMode}
                  disabled={locked}
                  onChange={(e) => patch(row.key, { inputMode: e.target.value as "GROSS" | "NET" })}
                  className="min-h-9 rounded-lg border border-border-strong bg-surface px-2 text-xs text-foreground disabled:opacity-60"
                >
                  <option value="NET">Neto (lo que recibimos)</option>
                  <option value="GROSS">Bruto (lo que paga)</option>
                </select>
                <input
                  aria-label="Referencia"
                  placeholder="Referencia"
                  value={row.reference}
                  onChange={(e) => patch(row.key, { reference: e.target.value })}
                  className="min-h-9 flex-1 rounded-lg border border-border-strong bg-surface px-2 text-xs text-foreground"
                />
                {!locked && (
                  <button
                    type="button"
                    onClick={() => setRows((list) => list.filter((r) => r.key !== row.key))}
                    className="min-h-9 px-2 text-xs font-medium text-danger hover:opacity-80"
                  >
                    Quitar
                  </button>
                )}
              </div>

              {emitted && canVoidContracts && (
                <label className="flex items-center gap-2 text-[11px] text-text-secondary">
                  <input
                    type="checkbox"
                    checked={Boolean(row.voidContract)}
                    onChange={(e) => patch(row.key, { voidContract: e.target.checked })}
                  />
                  Anular el contrato ya emitido para poder cambiar este pago
                </label>
              )}
              {locked && (
                <p className="text-[11px] text-muted-foreground">
                  Este dinero ya entró. Para cambiarlo, primero deshaz la acreditación o el cobro
                  desde la ficha de la venta.
                </p>
              )}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={add}
        className="min-h-9 rounded-lg border border-dashed border-border-strong px-3 text-xs font-medium text-text-secondary hover:bg-surface-muted hover:text-foreground"
      >
        + Agregar pago
      </button>

      <div className="space-y-2 border-t border-border pt-3">
        <label className="block text-xs font-medium text-text-secondary" htmlFor="financing-reason">
          Motivo del cambio
        </label>
        <input
          id="financing-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Por qué se corrige (queda en el historial de la venta)"
          className="min-h-10 w-full rounded-lg border border-border-strong bg-surface px-3 text-sm text-foreground"
        />
        <Button
          variant="primary"
          size="sm"
          onClick={save}
          loading={saving}
          disabled={!dirty || reason.trim().length < 3}
          className="uppercase"
        >
          Guardar financiamientos
        </Button>
      </div>
    </Card>
  );
}

function strip(a: EditableAllocation) {
  return {
    id: a.id,
    paymentMethodId: a.paymentMethodId,
    planId: a.planId,
    inputMode: a.inputMode,
    amountCents: a.amountCents,
    reference: a.reference,
  };
}

function errorMessage(code?: string): string {
  switch (code) {
    case "NOT_OWNER":
      return "Esta venta no es tuya.";
    case "SALE_PAID":
      return "Una venta pagada solo la corrige administración.";
    case "REASON_REQUIRED":
      return "Escribe el motivo del cambio.";
    case "PAYMENT_METHOD_INVALID":
      return "Hay un método de pago que ya no está disponible.";
    case "PLAN_INVALID":
      return "El plan elegido no pertenece a esa financiera.";
    default:
      return "No pudimos guardar los financiamientos.";
  }
}

function blockedMessage(
  b: BlockedAllocation,
  rows: Row[],
  byId: Map<string, PaymentMethodView>,
  canVoid: boolean,
): string {
  const row = rows.find((r) => r.id === b.allocationId);
  const name = row ? byId.get(row.paymentMethodId)?.name ?? "Pago" : "Pago";
  if (b.code === "MONEY_ALREADY_IN") {
    const what = b.lock === "SETTLED" ? "ya está cobrado" : "ya está acreditado";
    return b.removal
      ? `${name}: no se puede quitar porque ${what}. Deshaz primero el cobro.`
      : `${name}: no se puede cambiar porque ${what}. Deshaz primero el cobro.`;
  }
  if (b.code === "CONTRACT_EMITTED") {
    return canVoid
      ? `${name}: tiene un contrato emitido. Marca "anular el contrato" para poder cambiarlo.`
      : `${name}: tiene un contrato emitido. Pídele a administración que lo anule.`;
  }
  return `${name}: ${b.code}`;
}
