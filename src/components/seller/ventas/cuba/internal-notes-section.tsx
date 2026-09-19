"use client";

import { useFormContext } from "react-hook-form";
import type { CubaSaleFormValues } from "@/lib/sales/schema";
import { TextAreaField } from "@/components/ui/form-fields";

export function InternalNotesSection() {
  const { register } = useFormContext<CubaSaleFormValues>();
  return (
    <TextAreaField
      label="Notas internas (opcional)"
      placeholder="Detalles, acuerdos especiales, observaciones del vendedor…"
      hint="Información interna del concesionario. No se comparte con el cliente."
      rows={4}
      {...register("internalNotes")}
    />
  );
}
