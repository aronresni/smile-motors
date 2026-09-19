"use client";

import { Controller, useFieldArray, useFormContext } from "react-hook-form";
import type { CubaSaleFormValues } from "@/lib/sales/schema";
import { multiplyCents, formatCents } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/form-fields";
import { MoneyField } from "@/components/ui/money-field";

function makeEmptyExtra(key: string): CubaSaleFormValues["extras"][number] {
  return { key, description: "", quantity: 1, unitAmountCents: 0 };
}

export function ExtrasSection() {
  const {
    control,
    register,
    watch,
    formState: { errors },
  } = useFormContext<CubaSaleFormValues>();
  const { fields, append, remove } = useFieldArray({
    control,
    name: "extras",
    keyName: "_id",
  });

  const extras = watch("extras");

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Cargos adicionales de la operación (opcional).
        </p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => append(makeEmptyExtra(crypto.randomUUID()))}
        >
          + Agregar extra
        </Button>
      </div>

      {fields.length === 0 && (
        <p className="rounded-xl border border-dashed border-border bg-surface-muted/40 px-4 py-6 text-center text-xs text-muted-foreground">
          Sin extras.
        </p>
      )}

      <div className="space-y-3">
        {fields.map((field, index) => {
          const extraErr = errors.extras?.[index];
          const lineTotal = multiplyCents(
            extras?.[index]?.unitAmountCents ?? 0,
            extras?.[index]?.quantity ?? 0,
          );
          return (
            <div
              key={field._id}
              className="rounded-xl border border-border bg-surface-muted/40 p-3"
            >
              <div className="grid gap-3 sm:grid-cols-[1fr_88px_140px_auto] sm:items-start">
                <TextField
                  label="Descripción"
                  error={extraErr?.description?.message}
                  {...register(`extras.${index}.description`)}
                />
                <TextField
                  label="Cant."
                  type="number"
                  min={1}
                  inputMode="numeric"
                  error={extraErr?.quantity?.message}
                  {...register(`extras.${index}.quantity`, {
                    valueAsNumber: true,
                  })}
                />
                <Controller
                  control={control}
                  name={`extras.${index}.unitAmountCents`}
                  render={({ field: f, fieldState }) => (
                    <MoneyField
                      label="Importe unitario"
                      valueCents={f.value}
                      onChangeCents={f.onChange}
                      onBlur={f.onBlur}
                      error={fieldState.error?.message}
                    />
                  )}
                />
                <div className="flex items-end justify-between gap-2 sm:flex-col sm:items-end">
                  <span className="text-xs tabular-nums text-text-secondary">
                    {formatCents(lineTotal)}
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(index)}
                    aria-label={`Quitar extra ${index + 1}`}
                    className="text-xs font-medium text-danger hover:opacity-80"
                  >
                    Quitar
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
