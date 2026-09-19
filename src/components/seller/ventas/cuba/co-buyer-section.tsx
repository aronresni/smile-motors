"use client";

import { useFormContext } from "react-hook-form";
import type { CubaSaleFormValues } from "@/lib/sales/schema";
import { TextField } from "@/components/ui/form-fields";
import { Button } from "@/components/ui/button";

function blankCoBuyer(): NonNullable<CubaSaleFormValues["coBuyer"]> {
  return {
    firstName: "",
    lastName: "",
    dateOfBirth: "",
    documentNumber: "",
    phone: "",
    email: "",
  };
}

export function CoBuyerSection() {
  const {
    register,
    setValue,
    watch,
    formState: { errors },
  } = useFormContext<CubaSaleFormValues>();

  const coBuyer = watch("coBuyer");

  if (!coBuyer) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-xs text-muted-foreground">
          Opcional. Agrega un segundo titular de la compra.
        </p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            setValue("coBuyer", blankCoBuyer(), { shouldDirty: true })
          }
        >
          + Agregar co-buyer
        </Button>
      </div>
    );
  }

  const err = errors.coBuyer;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Segundo titular de la compra.
        </p>
        <Button
          variant="danger"
          size="sm"
          onClick={() => setValue("coBuyer", null, { shouldDirty: true })}
        >
          Quitar co-buyer
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Nombre/s"
          required
          error={err?.firstName?.message}
          {...register("coBuyer.firstName")}
        />
        <TextField
          label="Apellido/s"
          required
          error={err?.lastName?.message}
          {...register("coBuyer.lastName")}
        />
        <TextField
          label="Fecha de nacimiento"
          type="date"
          hint="MM/DD/AAAA"
          error={err?.dateOfBirth?.message}
          {...register("coBuyer.dateOfBirth")}
        />
        <TextField
          label="N.º de ID / licencia"
          error={err?.documentNumber?.message}
          {...register("coBuyer.documentNumber")}
        />
        <TextField
          label="Teléfono"
          type="tel"
          inputMode="tel"
          error={err?.phone?.message}
          {...register("coBuyer.phone")}
        />
        <TextField
          label="Correo electrónico"
          type="email"
          inputMode="email"
          error={err?.email?.message}
          {...register("coBuyer.email")}
        />
      </div>
    </div>
  );
}
