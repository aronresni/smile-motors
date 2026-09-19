"use client";

import { useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import type { CubaSaleFormValues } from "@/lib/sales/schema";
import { formatCents, multiplyCents, sumCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { computeCommission, isPricingConfigured } from "@/lib/commission";
import {
  summarizeCoverage,
  type AllocationFormValue,
  type PaymentMethodView,
} from "@/lib/payments/allocation";

function Row({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: "default" | "success" | "warning" | "danger";
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "tabular-nums",
          strong && "font-semibold",
          tone === "success" && "text-success",
          tone === "warning" && "text-warning",
          tone === "danger" && "text-danger",
          (!tone || tone === "default") &&
            (strong ? "text-foreground" : "text-text-secondary"),
        )}
      >
        {value}
      </dd>
    </div>
  );
}

export function SaleSummary({
  variant,
  methodsById,
  hideCoverage,
}: {
  variant: "panel" | "inline";
  methodsById?: Record<string, PaymentMethodView>;
  /** Oculta las filas de liquidación (p. ej. edición de venta confirmada). */
  hideCoverage?: boolean;
}) {
  const { control } = useFormContext<CubaSaleFormValues>();
  const units = useWatch({ control, name: "units" }) ?? [];
  const extras = useWatch({ control, name: "extras" }) ?? [];
  const allocations = (useWatch({ control, name: "allocations" }) ??
    []) as AllocationFormValue[];

  const unitsSubtotal = sumCents(units.map((u) => u.agreedPriceCents || 0));
  const extrasTotal = sumCents(
    extras.map((e) => multiplyCents(e.unitAmountCents || 0, e.quantity || 0)),
  );
  const totalSale = unitsSubtotal + extrasTotal;

  // Comisión estimada (configuración vigente de cada producto): solo si todas
  // las unidades tienen producto configurado y precio >= precio fijo.
  const pricedUnits = units.filter((u) => u.catalogModelId);
  const estimable =
    pricedUnits.length > 0 &&
    pricedUnits.every(
      (u) =>
        isPricingConfigured(u.fixedPriceCents, u.fixedCommissionCents) &&
        (u.agreedPriceCents || 0) >= (u.fixedPriceCents ?? 0),
    );
  const estimatedCommission = estimable
    ? sumCents(
        pricedUnits.map(
          (u) => computeCommission(u.fixedPriceCents!, u.fixedCommissionCents!, u.agreedPriceCents || 0).finalCommissionCents,
        ),
      )
    : null;

  const coverage = summarizeCoverage(allocations, totalSale, methodsById ?? {});
  const remaining = coverage.remainingCents;

  const [open, setOpen] = useState(variant === "panel");

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Total operación
          </p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
            {formatCents(totalSale)}
          </p>
        </div>
        {variant === "inline" && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="text-xs font-medium text-accent"
          >
            {open ? "Ocultar detalle" : "Ver detalle"}
          </button>
        )}
      </div>

      {open && (
        <div className="mt-3 space-y-3">
          <dl className="space-y-1.5 border-t border-border pt-3 text-xs">
            <Row label="Subtotal unidades" value={formatCents(unitsSubtotal)} />
            <Row label="Extras" value={formatCents(extrasTotal)} />
            <Row label="Total operación" value={formatCents(totalSale)} strong />
            {estimatedCommission != null && (
              <Row label="Tu comisión estimada" value={formatCents(estimatedCommission)} tone="success" />
            )}
          </dl>

          {!hideCoverage && (
            <>
              <dl className="space-y-1.5 border-t border-border pt-3 text-xs">
                <Row
                  label="Total neto acreditado"
                  value={formatCents(coverage.netCoveredCents)}
                />
                <Row
                  label={remaining >= 0 ? "Restante" : "Exceso"}
                  value={formatCents(Math.abs(remaining))}
                  strong
                  tone={
                    remaining === 0
                      ? "success"
                      : remaining > 0
                        ? "warning"
                        : "danger"
                  }
                />
              </dl>

              <div>
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted">
                  <div
                    className={cn(
                      "h-full rounded-full transition-[width]",
                      coverage.status === "overfunded"
                        ? "bg-danger"
                        : "bg-accent",
                    )}
                    style={{ width: `${Math.min(100, coverage.pct)}%` }}
                  />
                </div>
                <p
                  className={cn(
                    "mt-1 text-[11px] font-medium",
                    coverage.status === "exact"
                      ? "text-success"
                      : coverage.status === "overfunded"
                        ? "text-danger"
                        : "text-muted-foreground",
                  )}
                >
                  {coverage.status === "exact"
                    ? "Operación cubierta · 100%"
                    : `${coverage.pct}% cubierto`}
                </p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
