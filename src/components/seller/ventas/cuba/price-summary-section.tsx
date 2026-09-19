"use client";

import { useFormContext, useWatch } from "react-hook-form";
import type { CubaSaleFormValues } from "@/lib/sales/schema";
import { formatCents, multiplyCents, sumCents } from "@/lib/money";

/**
 * RESUMEN DEL PRECIO — total autoritativo de la operación en vivo.
 * Misma definición que el backend: Σ precio pactado + extras + entrega.
 */
export function computeSaleTotalCents(v: {
  units: { agreedPriceCents?: number | null }[];
  extras: { unitAmountCents?: number | null; quantity?: number | null }[];
}): { unitsCents: number; extrasCents: number; deliveryCents: number; totalCents: number } {
  const unitsCents = sumCents((v.units ?? []).map((u) => u.agreedPriceCents || 0));
  const extrasCents = sumCents(
    (v.extras ?? []).map((e) => multiplyCents(e.unitAmountCents || 0, e.quantity || 0)),
  );
  const deliveryCents = 0; // sin motor de precio de envío todavía
  return { unitsCents, extrasCents, deliveryCents, totalCents: unitsCents + extrasCents + deliveryCents };
}

function Row({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className={strong ? "font-semibold text-foreground" : "text-muted-foreground"}>
        {label}
      </span>
      <span
        className={
          strong
            ? "tabular-nums text-base font-semibold text-foreground"
            : "tabular-nums text-text-secondary"
        }
      >
        {value}
      </span>
    </div>
  );
}

export function PriceSummarySection() {
  const { control } = useFormContext<CubaSaleFormValues>();
  const units = useWatch({ control, name: "units" }) ?? [];
  const extras = useWatch({ control, name: "extras" }) ?? [];

  const t = computeSaleTotalCents({ units, extras });

  return (
    <div className="space-y-3">
      <ul className="space-y-1.5">
        {units.length === 0 && (
          <li className="text-xs text-muted-foreground">Sin unidades todavía.</li>
        )}
        {units.map((u, i) => (
          <li
            key={u.key}
            className="flex items-center justify-between gap-3 rounded-lg bg-surface-muted/50 px-3 py-2 text-sm"
          >
            <span className="min-w-0 truncate text-foreground">
              {i + 1}. {u.modelName || "Sin modelo"}
              {u.variantLabel ? (
                <span className="text-muted-foreground"> · {u.variantLabel}</span>
              ) : null}
            </span>
            <span className="shrink-0 tabular-nums text-text-secondary">
              {formatCents(u.agreedPriceCents || 0)}
            </span>
          </li>
        ))}
      </ul>

      <dl className="space-y-1.5 border-t border-border pt-3">
        <Row label="Subtotal unidades" value={formatCents(t.unitsCents)} />
        <Row label="Extras" value={formatCents(t.extrasCents)} />
        <Row label="Entrega" value={formatCents(t.deliveryCents)} />
        <div className="mt-1 border-t border-border pt-2">
          <Row label="Total de la operación" value={formatCents(t.totalCents)} strong />
        </div>
      </dl>
    </div>
  );
}
