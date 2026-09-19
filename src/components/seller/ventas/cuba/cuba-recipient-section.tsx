"use client";

import { useCallback, useRef, useState } from "react";
import {
  Controller,
  useFormContext,
  type FieldPath,
} from "react-hook-form";
import type { CubaSaleFormValues } from "@/lib/sales/schema";
import type {
  ExtractedRecipientData,
  ExtractionFieldSource,
} from "@/lib/sales/types";
import { extractRecipientId } from "@/lib/sales/document-extraction";
import { CUBA_PROVINCES } from "@/lib/sales/cuba-provinces";
import { SelectField, TextField } from "@/components/ui/form-fields";
import { PhoneField } from "@/components/ui/phone-field";
import { DocumentUploader } from "@/components/seller/ventas/document-uploader";
import { OcrBanner } from "@/components/seller/ventas/cuba/ocr-banner";
import { useIdExtraction } from "@/components/seller/ventas/cuba/use-id-extraction";

/**
 * Solo se autocompletan datos de IDENTIDAD del carné. La dirección/DOB que
 * pueda traer el documento se leen (quedan en `ExtractedRecipientData` para
 * revisión) pero NO se aplican: la dirección de entrega, el municipio, la
 * provincia y los teléfonos son información operativa y los pone el vendedor.
 */
const FIELD_MAP: [keyof ExtractedRecipientData, FieldPath<CubaSaleFormValues>][] =
  [
    ["fullName", "cubaRecipient.fullName"],
    ["identityNumber", "cubaRecipient.identityNumber"],
  ];

const FIELD_LABELS: Partial<Record<FieldPath<CubaSaleFormValues>, string>> = {
  "cubaRecipient.fullName": "Nombre completo",
  "cubaRecipient.identityNumber": "Carné de Identidad (CI)",
};

/** La zona legible por máquina del reverso es la fuente estructurada de
 * mayor confianza para el carné cubano (equivalente al PDF417 en EE. UU.). */
const SOURCE_RANK: Record<ExtractionFieldSource, number> = {
  "ocr-front": 1,
  "ocr-back": 2,
  "mrz-back": 3,
  pdf417: 3, // sin uso en carnés cubanos
};

export function CubaRecipientSection() {
  const {
    register,
    control,
    getValues,
    setValue,
    formState: { errors },
  } = useFormContext<CubaSaleFormValues>();

  const [autoFilled, setAutoFilled] = useState<Set<string>>(new Set());
  const [conflicts, setConflicts] = useState<string[]>([]);
  const autoFillsRef = useRef<
    Record<string, { source: ExtractionFieldSource; value: string }>
  >({});

  const applyRecipientData = useCallback(
    (
      data: ExtractedRecipientData,
      _fieldsDetected: string[],
      sources: Partial<Record<string, ExtractionFieldSource>>,
    ) => {
      const filled: string[] = [];
      const newConflicts: string[] = [];
      for (const [key, path] of FIELD_MAP) {
        const value = data[key];
        if (!value) continue;

        const current = String(getValues(path) ?? "");
        const prior = autoFillsRef.current[path];
        const newSource: ExtractionFieldSource = sources[key] ?? "ocr-front";
        const isEmpty = current.trim() === "";
        const isUntouchedAutofill =
          prior !== undefined && current === prior.value;
        const strongerSource =
          prior !== undefined &&
          SOURCE_RANK[newSource] > SOURCE_RANK[prior.source];

        if (!isEmpty && !(isUntouchedAutofill && strongerSource)) {
          if (!isEmpty && current !== value) {
            newConflicts.push(FIELD_LABELS[path] ?? path);
          }
          continue;
        }

        setValue(path, value as never, { shouldDirty: true });
        autoFillsRef.current[path] = { source: newSource, value };
        filled.push(path);
      }
      if (filled.length) {
        setAutoFilled((prev) => {
          const next = new Set(prev);
          filled.forEach((f) => next.add(f));
          return next;
        });
      }
      setConflicts(newConflicts);
    },
    [getValues, setValue],
  );

  const ocr = useIdExtraction<ExtractedRecipientData>(
    extractRecipientId,
    applyRecipientData,
  );

  const err = errors.cubaRecipient;

  return (
    <div className="space-y-5">
      <p className="text-xs text-muted-foreground">
        Persona que recibirá el producto en Cuba. Es distinta del comprador.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <Controller
          control={control}
          name="cubaRecipient.documentFront"
          render={({ field }) => (
            <DocumentUploader
              label="Documento de identidad del receptor — frente"
              value={field.value}
              onChange={field.onChange}
              onImageSaved={(dataUrl) =>
                ocr.trigger(
                  dataUrl,
                  getValues("cubaRecipient.documentBack")?.dataUrl ?? undefined,
                )
              }
            />
          )}
        />
        <Controller
          control={control}
          name="cubaRecipient.documentBack"
          render={({ field }) => (
            <DocumentUploader
              label="Documento de identidad del receptor — reverso"
              value={field.value}
              onChange={field.onChange}
              onImageSaved={(dataUrl) =>
                ocr.trigger(
                  getValues("cubaRecipient.documentFront")?.dataUrl ?? undefined,
                  dataUrl,
                )
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
          label="Nombre completo del receptor"
          required
          autoFilled={autoFilled.has("cubaRecipient.fullName")}
          error={err?.fullName?.message}
          {...register("cubaRecipient.fullName")}
        />
        <TextField
          label="Carné de Identidad (CI)"
          required
          inputMode="numeric"
          autoFilled={autoFilled.has("cubaRecipient.identityNumber")}
          error={err?.identityNumber?.message}
          {...register("cubaRecipient.identityNumber")}
        />
        <TextField
          label="Dirección de entrega"
          required
          autoFilled={autoFilled.has("cubaRecipient.deliveryAddress")}
          error={err?.deliveryAddress?.message}
          containerClassName="sm:col-span-2"
          {...register("cubaRecipient.deliveryAddress")}
        />
        <TextField
          label="Municipio"
          hint="Texto libre por ahora."
          error={err?.municipality?.message}
          {...register("cubaRecipient.municipality")}
        />
        <SelectField
          label="Provincia"
          required
          placeholder="Selecciona…"
          error={err?.province?.message}
          options={CUBA_PROVINCES.map((p) => ({ value: p, label: p }))}
          {...register("cubaRecipient.province")}
        />
        <Controller
          control={control}
          name="cubaRecipient.phonePrimary"
          render={({ field, fieldState }) => (
            <PhoneField
              label="Teléfono principal"
              country="cu"
              required
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
            />
          )}
        />
        <Controller
          control={control}
          name="cubaRecipient.phoneSecondary"
          render={({ field, fieldState }) => (
            <PhoneField
              label="Teléfono secundario (opcional)"
              country="cu"
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
            />
          )}
        />
      </div>
    </div>
  );
}
