"use client";

import { useCallback, useRef, useState } from "react";
import {
  Controller,
  useFormContext,
  type FieldPath,
} from "react-hook-form";
import type { CubaSaleFormValues } from "@/lib/sales/schema";
import type {
  ExtractedDocumentData,
  ExtractionFieldSource,
} from "@/lib/sales/types";
import { extractBuyerId } from "@/lib/sales/document-extraction";
import { US_STATES } from "@/lib/sales/us-states";
import {
  SelectField,
  TextField,
} from "@/components/ui/form-fields";
import { PhoneField } from "@/components/ui/phone-field";
import { DocumentUploader } from "@/components/seller/ventas/document-uploader";
import { useIdExtraction } from "@/components/seller/ventas/cuba/use-id-extraction";
import { OcrBanner } from "@/components/seller/ventas/cuba/ocr-banner";

const FIELD_MAP: [keyof ExtractedDocumentData, FieldPath<CubaSaleFormValues>][] =
  [
    ["firstName", "buyer.firstName"],
    ["lastName", "buyer.lastName"],
    ["dateOfBirth", "buyer.dateOfBirth"],
    ["documentNumber", "buyer.documentNumber"],
    ["expirationDate", "buyer.documentExpiration"],
    ["addressLine1", "buyer.addressLine1"],
    ["city", "buyer.city"],
    ["state", "buyer.state"],
    ["postalCode", "buyer.postalCode"],
  ];

const FIELD_LABELS: Partial<Record<FieldPath<CubaSaleFormValues>, string>> = {
  "buyer.firstName": "Nombre/s",
  "buyer.lastName": "Apellido/s",
  "buyer.dateOfBirth": "Fecha de nacimiento",
  "buyer.documentNumber": "N.º de ID / licencia",
  "buyer.documentExpiration": "Expiración",
  "buyer.addressLine1": "Dirección",
  "buyer.city": "Ciudad",
  "buyer.state": "Estado",
  "buyer.postalCode": "Código postal",
};

/** pdf417 gana a OCR; el reverso (donde está el PDF417) gana al frente. */
const SOURCE_RANK: Record<ExtractionFieldSource, number> = {
  "ocr-front": 1,
  "ocr-back": 2,
  "mrz-back": 2, // sin uso en licencias US; mismo nivel que ocr-back por si acaso
  pdf417: 3,
};

export function BuyerSection() {
  const {
    register,
    control,
    getValues,
    setValue,
    formState: { errors },
  } = useFormContext<CubaSaleFormValues>();

  const [autoFilled, setAutoFilled] = useState<Set<string>>(new Set());
  // Campos donde el documento sugiere un valor distinto al que ya hay en el
  // formulario (y no es una corrección de un autofill previo): NUNCA se
  // pisa en silencio, se marca para que el vendedor lo revise.
  const [conflicts, setConflicts] = useState<string[]>([]);
  // Recuerda qué valor pusimos y con qué origen, para poder mejorar un dato de
  // OCR con PDF417 SIN pisar una corrección manual del vendedor.
  const autoFillsRef = useRef<
    Record<string, { source: ExtractionFieldSource; value: string }>
  >({});

  const applyBuyerData = useCallback(
    (
      data: ExtractedDocumentData,
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
          // Un valor manual (o ya corregido) distinto al leído: se conserva,
          // pero se señala para revisión en vez de ignorarlo en silencio.
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

  const ocr = useIdExtraction<ExtractedDocumentData>(
    extractBuyerId,
    applyBuyerData,
  );

  const buyerErr = errors.buyer;

  return (
    <div className="space-y-5">
      {/* Documentos */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Controller
          control={control}
          name="buyer.documentFront"
          render={({ field, fieldState }) => (
            <DocumentUploader
              label="ID del comprador — frente"
              required
              value={field.value}
              onChange={field.onChange}
              error={fieldState.error?.message}
              onImageSaved={(dataUrl) =>
                ocr.trigger(dataUrl, getValues("buyer.documentBack")?.dataUrl ?? undefined)
              }
            />
          )}
        />
        <Controller
          control={control}
          name="buyer.documentBack"
          render={({ field, fieldState }) => (
            <DocumentUploader
              label="ID del comprador — reverso"
              required
              value={field.value}
              onChange={field.onChange}
              error={fieldState.error?.message}
              onImageSaved={(dataUrl) =>
                ocr.trigger(
                  getValues("buyer.documentFront")?.dataUrl ?? undefined,
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

      {/* Datos personales */}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Nombre/s"
          required
          autoComplete="given-name"
          autoFilled={autoFilled.has("buyer.firstName")}
          error={buyerErr?.firstName?.message}
          {...register("buyer.firstName")}
        />
        <TextField
          label="Apellido/s"
          required
          autoComplete="family-name"
          autoFilled={autoFilled.has("buyer.lastName")}
          error={buyerErr?.lastName?.message}
          {...register("buyer.lastName")}
        />
        <TextField
          label="Fecha de nacimiento"
          type="date"
          hint="MM/DD/AAAA"
          autoFilled={autoFilled.has("buyer.dateOfBirth")}
          error={buyerErr?.dateOfBirth?.message}
          {...register("buyer.dateOfBirth")}
        />
        <TextField
          label="N.º de ID / licencia"
          required
          autoFilled={autoFilled.has("buyer.documentNumber")}
          error={buyerErr?.documentNumber?.message}
          {...register("buyer.documentNumber")}
        />
        <TextField
          label="Expiración ID / licencia"
          type="date"
          hint="MM/DD/AAAA"
          autoFilled={autoFilled.has("buyer.documentExpiration")}
          error={buyerErr?.documentExpiration?.message}
          {...register("buyer.documentExpiration")}
        />
        <Controller
          control={control}
          name="buyer.phone"
          render={({ field, fieldState }) => (
            <PhoneField
              label="Teléfono"
              country="us"
              required
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              error={fieldState.error?.message}
            />
          )}
        />
        <TextField
          label="Correo electrónico"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="cliente@email.com"
          error={buyerErr?.email?.message}
          containerClassName="sm:col-span-2"
          {...register("buyer.email")}
        />
      </div>

      {/* Dirección del comprador */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Dirección del comprador
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Dirección (calle, número)"
            autoComplete="address-line1"
            autoFilled={autoFilled.has("buyer.addressLine1")}
            error={buyerErr?.addressLine1?.message}
            containerClassName="sm:col-span-2"
            {...register("buyer.addressLine1")}
          />
          <TextField
            label="Apartamento / unidad"
            autoComplete="address-line2"
            error={buyerErr?.addressLine2?.message}
            {...register("buyer.addressLine2")}
          />
          <TextField
            label="Ciudad"
            autoComplete="address-level2"
            autoFilled={autoFilled.has("buyer.city")}
            error={buyerErr?.city?.message}
            {...register("buyer.city")}
          />
          <SelectField
            label="Estado"
            placeholder="Selecciona…"
            autoFilled={autoFilled.has("buyer.state")}
            error={buyerErr?.state?.message}
            options={US_STATES.map((s) => ({
              value: s.code,
              label: `${s.code} · ${s.name}`,
            }))}
            {...register("buyer.state")}
          />
          <TextField
            label="Código postal / ZIP"
            inputMode="numeric"
            autoComplete="postal-code"
            autoFilled={autoFilled.has("buyer.postalCode")}
            error={buyerErr?.postalCode?.message}
            {...register("buyer.postalCode")}
          />
        </div>
      </div>
    </div>
  );
}
