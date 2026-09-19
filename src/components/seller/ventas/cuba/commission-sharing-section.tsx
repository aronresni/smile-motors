"use client";

import { Controller, useFormContext } from "react-hook-form";
import type { CubaSaleFormValues } from "@/lib/sales/schema";
import { Toggle } from "@/components/ui/toggle";

export function CommissionSharingSection() {
  const { control } = useFormContext<CubaSaleFormValues>();

  return (
    <Controller
      control={control}
      name="commissionSharing"
      render={({ field }) => (
        <div className="space-y-3">
          <Toggle
            label="Compartir comisión"
            description="Divide la comisión de esta venta con otro vendedor."
            checked={field.value.enabled}
            onChange={(enabled) =>
              field.onChange({
                enabled,
                partnerSellerId: enabled ? field.value.partnerSellerId : null,
              })
            }
          />
          {field.value.enabled && (
            <div className="rounded-xl border border-dashed border-border bg-surface-muted/50 px-4 py-4 text-xs leading-relaxed text-muted-foreground">
              La selección del otro vendedor y la regla de reparto se habilitarán
              con el motor de comisiones. Por ahora la venta solo queda marcada
              como <span className="text-text-secondary">comisión compartida</span>.
            </div>
          )}
        </div>
      )}
    />
  );
}
