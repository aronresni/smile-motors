"use client";

import { Controller, useFormContext, type FieldPath } from "react-hook-form";
import type { CubaSaleFormValues } from "@/lib/sales/schema";
import { emptyDocument, type ExtractedDocumentData } from "@/lib/sales/types";
import { extractBuyerId } from "@/lib/sales/document-extraction";
import { TextField } from "@/components/ui/form-fields";
import { Button } from "@/components/ui/button";
import { DocumentUploader } from "@/components/seller/ventas/document-uploader";
import { useIdExtraction } from "@/components/seller/ventas/cuba/use-id-extraction";
import { useDocumentAutofill } from "@/components/seller/ventas/cuba/use-document-autofill";
import { OcrBanner } from "@/components/seller/ventas/cuba/ocr-banner";

/** Solo los datos que el co-buyer tiene en la venta (sale_parties): del ID
 * NO se toman dirección ni vencimiento, que el co-buyer no registra. */
const FIELD_MAP: [keyof ExtractedDocumentData, FieldPath<CubaSaleFormValues>][] = [
  ["firstName", "coBuyer.firstName"],
  ["lastName", "coBuyer.lastName"],
  ["dateOfBirth", "coBuyer.dateOfBirth"],
  ["documentNumber", "coBuyer.documentNumber"],
];

const FIELD_LABELS: Partial<Record<FieldPath<CubaSaleFormValues>, string>> = {
  "coBuyer.firstName": "Nombre/s",
  "coBuyer.lastName": "Apellido/s",
  "coBuyer.dateOfBirth": "Fecha de nacimiento",
  "coBuyer.documentNumber": "N.º de ID / licencia",
};

function blankCoBuyer(): NonNullable<CubaSaleFormValues["coBuyer"]> {
  return {
    documentFront: emptyDocument(),
    documentBack: emptyDocument(),
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
    control,
    getValues,
    setValue,
    watch,
    formState: { errors },
  } = useFormContext<CubaSaleFormValues>();

  const autofill = useDocumentAutofill<ExtractedDocumentData>(FIELD_MAP, FIELD_LABELS);
  const ocr = useIdExtraction<ExtractedDocumentData>(extractBuyerId, autofill.apply);

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
  const { autoFilled, conflicts } = autofill;

  const removeCoBuyer = () => {
    setValue("coBuyer", null, { shouldDirty: true });
    autofill.reset();
    ocr.reset();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Segundo titular de la compra.
        </p>
        <Button variant="danger" size="sm" onClick={removeCoBuyer}>
          Quitar co-buyer
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Opcional: sube el ID del co-buyer y completamos sus datos
        automáticamente. Revísalos antes de continuar.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Controller
          control={control}
          name="coBuyer.documentFront"
          render={({ field }) => (
            <DocumentUploader
              label="ID del co-buyer — frente"
              value={field.value ?? emptyDocument()}
              onChange={field.onChange}
              onImageSaved={(dataUrl) =>
                ocr.trigger(dataUrl, getValues("coBuyer.documentBack")?.dataUrl ?? undefined)
              }
            />
          )}
        />
        <Controller
          control={control}
          name="coBuyer.documentBack"
          render={({ field }) => (
            <DocumentUploader
              label="ID del co-buyer — reverso"
              value={field.value ?? emptyDocument()}
              onChange={field.onChange}
              onImageSaved={(dataUrl) =>
                ocr.trigger(getValues("coBuyer.documentFront")?.dataUrl ?? undefined, dataUrl)
              }
            />
          )}
        />
      </div>

      <OcrBanner
        status={ocr.status}
        message={ocr.message}
        suggestReadjust={ocr.suggestReadjust}
      />
      {conflicts.length > 0 && (
        <p
          role="alert"
          className="rounded-xl border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-xs text-warning"
        >
          El documento sugiere un valor distinto al ingresado para:{" "}
          <strong>{conflicts.join(", ")}</strong>. Revisa el campo antes de
          continuar.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Nombre/s"
          required
          autoFilled={autoFilled.has("coBuyer.firstName")}
          error={err?.firstName?.message}
          {...register("coBuyer.firstName")}
        />
        <TextField
          label="Apellido/s"
          required
          autoFilled={autoFilled.has("coBuyer.lastName")}
          error={err?.lastName?.message}
          {...register("coBuyer.lastName")}
        />
        <TextField
          label="Fecha de nacimiento"
          type="date"
          hint="MM/DD/AAAA"
          autoFilled={autoFilled.has("coBuyer.dateOfBirth")}
          error={err?.dateOfBirth?.message}
          {...register("coBuyer.dateOfBirth")}
        />
        <TextField
          label="N.º de ID / licencia"
          autoFilled={autoFilled.has("coBuyer.documentNumber")}
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
