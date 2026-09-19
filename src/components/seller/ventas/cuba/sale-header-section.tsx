"use client";

import { useFormContext } from "react-hook-form";
import type { CubaSaleFormValues } from "@/lib/sales/schema";
import { ReadOnlyField, TextField } from "@/components/ui/form-fields";

/**
 * Encabezado de la venta: vendedor (automático, no editable) + fecha.
 * `sellerId` / `sellerName` vienen del perfil autenticado y no se registran
 * como campos editables.
 */
export function SaleHeaderSection() {
  const {
    register,
    getValues,
    formState: { errors },
  } = useFormContext<CubaSaleFormValues>();

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <ReadOnlyField
        label="Vendedor"
        value={getValues("sellerName")}
        hint="Se asigna desde tu perfil. No se puede cambiar el titular de la venta."
      />
      <TextField
        label="Fecha de venta"
        type="date"
        required
        hint="MM/DD/AAAA"
        error={errors.saleDate?.message}
        {...register("saleDate")}
      />
    </div>
  );
}
