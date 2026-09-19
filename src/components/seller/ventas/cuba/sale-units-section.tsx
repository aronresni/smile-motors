"use client";

import { useFieldArray, useFormContext } from "react-hook-form";
import type { CubaSaleFormValues } from "@/lib/sales/schema";
import { Button } from "@/components/ui/button";
import { SaleUnitCard } from "@/components/seller/ventas/cuba/sale-unit-card";

export function makeEmptyUnit(key: string): CubaSaleFormValues["units"][number] {
  return {
    key,
    catalogModelId: null,
    modelName: "",
    variantId: null,
    variantLabel: "",
    listPriceCents: null,
    agreedPriceCents: 0,
  };
}

export function SaleUnitsSection() {
  const { control, formState } = useFormContext<CubaSaleFormValues>();
  const { fields, append, remove } = useFieldArray({
    control,
    name: "units",
    keyName: "_id",
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Unidades en el pedido ·{" "}
          <span className="font-medium text-text-secondary">
            {fields.length}
          </span>
        </p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => append(makeEmptyUnit(crypto.randomUUID()))}
        >
          + Agregar unidad
        </Button>
      </div>

      {typeof formState.errors.units?.message === "string" && (
        <p className="text-[11px] text-danger">
          {formState.errors.units.message}
        </p>
      )}

      <div className="space-y-3">
        {fields.map((field, index) => (
          <SaleUnitCard
            key={field._id}
            index={index}
            canRemove={fields.length > 1}
            onRemove={() => remove(index)}
          />
        ))}
      </div>
    </div>
  );
}
