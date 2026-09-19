"use client";

import { useMemo, useState } from "react";
import { useFieldArray, useFormContext, useWatch } from "react-hook-form";
import type { CubaSaleFormValues } from "@/lib/sales/schema";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  settleAllocation,
  summarizeCoverage,
  type AllocationFormValue,
  type PaymentMethodView,
} from "@/lib/payments/allocation";
import { formatBps } from "@/lib/payments/fee-engine";
import { computeSaleTotalCents } from "@/components/seller/ventas/cuba/price-summary-section";
import { PaymentAllocationEditor } from "@/components/seller/ventas/cuba/payment-allocation-editor";
import { FinancingSelectorDrawer } from "@/components/seller/ventas/cuba/financing-selector-drawer";

interface Props {
  methods: PaymentMethodView[];
  methodsById: Record<string, PaymentMethodView>;
}

const STATUS_UI: Record<
  ReturnType<typeof summarizeCoverage>["status"],
  { label: string; cls: string }
> = {
  empty: { label: "Sin métodos de pago", cls: "text-muted-foreground" },
  underfunded: { label: "Falta cobertura", cls: "text-warning" },
  exact: { label: "Operación cubierta", cls: "text-success" },
  overfunded: { label: "Liquidación en exceso", cls: "text-danger" },
};

export function LiquidationSection({ methods, methodsById }: Props) {
  const { control } = useFormContext<CubaSaleFormValues>();
  const { fields, append, update, remove } = useFieldArray({
    control,
    name: "allocations",
    keyName: "_id",
  });

  const units = useWatch({ control, name: "units" }) ?? [];
  const extras = useWatch({ control, name: "extras" }) ?? [];
  const allocationsWatch = useWatch({ control, name: "allocations" });
  const allocations = useMemo(
    () => (allocationsWatch ?? []) as AllocationFormValue[],
    [allocationsWatch],
  );
  const buyerState = (useWatch({ control, name: "buyer.state" }) ?? "") as string;

  const saleTotal = computeSaleTotalCents({ units, extras }).totalCents;
  const coverage = useMemo(
    () => summarizeCoverage(allocations, saleTotal, methodsById),
    [allocations, saleTotal, methodsById],
  );

  const cardMethod = methods.find((m) => m.methodType === "CARD") ?? null;
  const zelleMethod = methods.find((m) => m.methodType === "ZELLE") ?? null;

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editor, setEditor] = useState<{
    method: PaymentMethodView | null;
    index: number | null;
  }>({ method: null, index: null });

  const openNew = (method: PaymentMethodView | null) =>
    setEditor({ method, index: null });
  const openEdit = (index: number) => {
    const a = allocations[index];
    setEditor({ method: methodsById[a.paymentMethodId] ?? null, index });
  };
  const closeEditor = () => setEditor({ method: null, index: null });

  const handleSave = (value: AllocationFormValue) => {
    if (editor.index != null) update(editor.index, value);
    else append(value);
    closeEditor();
  };

  const remaining = coverage.remainingCents;
  const status = STATUS_UI[coverage.status];

  const floridaConflict = allocations.some(
    (a) =>
      (methodsById[a.paymentMethodId]?.onlyFlorida ?? a.onlyFlorida) &&
      buyerState.toUpperCase() !== "FL",
  );

  return (
    <div className="space-y-4">
      {/* ---- cobertura ---- */}
      <div className="rounded-xl border border-border bg-surface-muted/40 p-3.5">
        <dl className="grid grid-cols-3 gap-2 text-center">
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Total a cubrir
            </dt>
            <dd className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
              {formatCents(saleTotal)}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Neto acreditado
            </dt>
            <dd className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
              {formatCents(coverage.netCoveredCents)}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {remaining >= 0 ? "Restante" : "Exceso"}
            </dt>
            <dd
              className={cn(
                "mt-0.5 text-sm font-semibold tabular-nums",
                remaining === 0
                  ? "text-success"
                  : remaining > 0
                    ? "text-warning"
                    : "text-danger",
              )}
            >
              {formatCents(Math.abs(remaining))}
            </dd>
          </div>
        </dl>

        <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-muted">
          <div
            className={cn(
              "h-full rounded-full transition-[width]",
              coverage.status === "overfunded" ? "bg-danger" : "bg-accent",
            )}
            style={{ width: `${Math.min(100, coverage.pct)}%` }}
          />
        </div>
        <p className={cn("mt-1.5 text-xs font-medium", status.cls)}>
          {coverage.status === "exact"
            ? "Operación cubierta · 100%"
            : coverage.status === "underfunded"
              ? `Faltan ${formatCents(remaining)} por cubrir · ${coverage.pct}%`
              : coverage.status === "overfunded"
                ? `La liquidación supera el total por ${formatCents(-remaining)}`
                : status.label}
        </p>
        {floridaConflict && (
          <p role="alert" className="mt-1.5 text-xs text-danger">
            Un método seleccionado solo está disponible para clientes de Florida
            (FL). Corrige el estado del comprador o quita ese método.
          </p>
        )}
        {coverage.hasInvalid && !floridaConflict && (
          <p role="alert" className="mt-1.5 text-xs text-danger">
            Hay un pago con configuración incompleta (revisa el plazo).
          </p>
        )}
      </div>

      {/* ---- acciones ---- */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={!cardMethod}
          onClick={() => openNew(cardMethod)}
        >
          Agregar tarjeta
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={!zelleMethod}
          onClick={() => openNew(zelleMethod)}
        >
          Agregar Zelle
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setDrawerOpen(true)}>
          Gestionar financieras
        </Button>
      </div>

      {/* ---- lista ---- */}
      {fields.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-surface-muted/40 px-4 py-6 text-center text-xs text-muted-foreground">
          No has seleccionado un método de pago.
        </p>
      ) : (
        <ul className="space-y-2">
          {fields.map((f, i) => {
            const a = allocations[i] ?? (f as unknown as AllocationFormValue);
            const method = methodsById[a.paymentMethodId];
            const s = settleAllocation(a, method);
            return (
              <li
                key={f._id}
                className="rounded-xl border border-border bg-surface p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {a.methodName || method?.name || "Método"}
                      {a.planLabel ? (
                        <span className="text-muted-foreground">
                          {" "}
                          · {a.planLabel}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {a.inputMode === "NET" ? "Ingresado como NETO" : "Ingresado como BRUTO"}
                      {a.reference ? ` · ${a.reference}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openEdit(i)}
                      className="text-xs font-medium text-accent hover:opacity-80"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(i)}
                      className="text-xs font-medium text-danger hover:opacity-80"
                    >
                      Quitar
                    </button>
                  </div>
                </div>

                <dl className="mt-2 grid grid-cols-3 gap-1 text-xs">
                  <div>
                    <dt className="text-muted-foreground">Bruto</dt>
                    <dd className="tabular-nums text-text-secondary">
                      {formatCents(s.grossCents)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">
                      Fee
                      {a.feeStrategy === "FLAT_RATE" && method?.flatFeeBps != null
                        ? ` ${formatBps(method.flatFeeBps)}`
                        : ""}
                    </dt>
                    <dd className="tabular-nums text-danger">
                      −{formatCents(s.feeCents)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Neto</dt>
                    <dd className="tabular-nums font-semibold text-foreground">
                      {formatCents(s.netCents)}
                    </dd>
                  </div>
                </dl>
                {s.error && (
                  <p className="mt-1 text-[11px] text-danger">{s.error}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <PaymentAllocationEditor
        key={`${editor.method?.id ?? "none"}:${editor.index ?? "new"}`}
        open={editor.method != null}
        method={editor.method}
        initial={editor.index != null ? allocations[editor.index] : null}
        suggestedNetCents={
          editor.index != null ? undefined : Math.max(0, remaining)
        }
        buyerState={buyerState}
        onClose={closeEditor}
        onSave={handleSave}
      />

      <FinancingSelectorDrawer
        open={drawerOpen}
        methods={methods}
        buyerState={buyerState}
        onClose={() => setDrawerOpen(false)}
        onPick={(m) => {
          setDrawerOpen(false);
          openNew(m);
        }}
      />
    </div>
  );
}
