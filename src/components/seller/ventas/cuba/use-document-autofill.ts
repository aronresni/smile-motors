"use client";

import { useCallback, useRef, useState } from "react";
import { useFormContext, type FieldPath } from "react-hook-form";
import type { CubaSaleFormValues } from "@/lib/sales/schema";
import type { ExtractionFieldSource } from "@/lib/sales/types";

type FormPath = FieldPath<CubaSaleFormValues>;

/** pdf417 gana a OCR; el reverso (donde está el PDF417) gana al frente. */
const SOURCE_RANK: Record<ExtractionFieldSource, number> = {
  "ocr-front": 1,
  "ocr-back": 2,
  "mrz-back": 2, // sin uso en licencias US; mismo nivel que ocr-back por si acaso
  pdf417: 3,
};

/**
 * Aplica al formulario los datos leídos de un documento (comprador,
 * co-buyer): completa campos vacíos, mejora un autocompletado previo con una
 * fuente más fiable (PDF417 > OCR) y NUNCA pisa en silencio un valor que el
 * vendedor escribió o corrigió — lo marca como conflicto para revisarlo.
 */
export function useDocumentAutofill<D extends object>(
  fieldMap: readonly (readonly [keyof D, FormPath])[],
  labels: Partial<Record<FormPath, string>>,
) {
  const { getValues, setValue } = useFormContext<CubaSaleFormValues>();
  const [autoFilled, setAutoFilled] = useState<Set<string>>(new Set());
  // Campos donde el documento sugiere un valor distinto al que ya hay en el
  // formulario (y no es una corrección de un autofill previo).
  const [conflicts, setConflicts] = useState<string[]>([]);
  // Recuerda qué valor pusimos y con qué origen, para poder mejorar un dato de
  // OCR con PDF417 SIN pisar una corrección manual del vendedor.
  const autoFillsRef = useRef<Record<string, { source: ExtractionFieldSource; value: string }>>({});

  const apply = useCallback(
    (
      data: D,
      _fieldsDetected: string[],
      sources: Partial<Record<string, ExtractionFieldSource>>,
    ) => {
      const filled: string[] = [];
      const newConflicts: string[] = [];
      for (const [key, path] of fieldMap) {
        const raw = data[key];
        if (!raw) continue;
        const value = String(raw);

        const current = String(getValues(path) ?? "");
        const prior = autoFillsRef.current[path];
        const newSource: ExtractionFieldSource = sources[key as string] ?? "ocr-front";
        const isEmpty = current.trim() === "";
        const isUntouchedAutofill = prior !== undefined && current === prior.value;
        const strongerSource =
          prior !== undefined && SOURCE_RANK[newSource] > SOURCE_RANK[prior.source];

        if (!isEmpty && !(isUntouchedAutofill && strongerSource)) {
          // Un valor manual (o ya corregido) distinto al leído: se conserva,
          // pero se señala para revisión en vez de ignorarlo en silencio.
          if (current !== value) newConflicts.push(labels[path] ?? path);
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
    [fieldMap, labels, getValues, setValue],
  );

  const reset = useCallback(() => {
    autoFillsRef.current = {};
    setAutoFilled(new Set());
    setConflicts([]);
  }, []);

  return { autoFilled, conflicts, apply, reset };
}
