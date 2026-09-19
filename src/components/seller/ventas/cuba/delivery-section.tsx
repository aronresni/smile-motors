"use client";

import { Controller, useFormContext } from "react-hook-form";
import type { CubaSaleFormValues } from "@/lib/sales/schema";
import type { DeliveryMethod } from "@/lib/sales/types";
import { TextField } from "@/components/ui/form-fields";
import { cn } from "@/lib/utils";

const METHODS: {
  value: DeliveryMethod;
  title: string;
  description: string;
}[] = [
  {
    value: "home_delivery",
    title: "Entrega puerta a puerta",
    description: "El producto se entrega en la dirección del receptor.",
  },
  {
    value: "pickup_point",
    title: "Punto de recogida",
    description: "El receptor retira en un punto acordado.",
  },
];

export function DeliverySection() {
  const {
    control,
    register,
    watch,
    formState: { errors },
  } = useFormContext<CubaSaleFormValues>();

  const method = watch("delivery.method");

  return (
    <div className="space-y-4">
      <Controller
        control={control}
        name="delivery.method"
        render={({ field, fieldState }) => (
          <div className="space-y-2">
            <div
              role="radiogroup"
              aria-label="Método de entrega"
              className="grid gap-2 sm:grid-cols-2"
            >
              {METHODS.map((m) => {
                const selected = field.value === m.value;
                return (
                  <button
                    key={m.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => field.onChange(m.value)}
                    className={cn(
                      "rounded-xl border p-3.5 text-left transition-colors",
                      selected
                        ? "border-accent bg-accent-soft"
                        : "border-border bg-surface hover:bg-surface-muted",
                    )}
                  >
                    <span
                      className={cn(
                        "block text-sm font-semibold",
                        selected ? "text-accent" : "text-foreground",
                      )}
                    >
                      {m.title}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {m.description}
                    </span>
                  </button>
                );
              })}
            </div>
            {fieldState.error && (
              <p className="text-[11px] text-danger">
                {fieldState.error.message}
              </p>
            )}
          </div>
        )}
      />

      {method === "pickup_point" && (
        <TextField
          label="Punto de recogida / referencia"
          placeholder="Nombre o dirección del punto"
          error={errors.delivery?.reference?.message}
          {...register("delivery.reference")}
        />
      )}
    </div>
  );
}
