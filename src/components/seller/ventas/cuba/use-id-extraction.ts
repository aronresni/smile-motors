"use client";

import { useCallback, useState } from "react";
import type {
  ExtractionErrorCode,
  ExtractionFieldSource,
  ExtractionResult,
  OcrStatus,
} from "@/lib/sales/types";

interface ExtractionInput {
  frontImage?: string;
  backImage?: string;
}

type ApplyData<T> = (
  data: T,
  fieldsDetected: string[],
  fieldSources: Partial<Record<string, ExtractionFieldSource>>,
) => void;

const GENERIC_FAILURE =
  "No pudimos leer los datos automáticamente. Puedes completarlos manualmente.";

/** Motivos que justifican ofrecer "Reajustar" la imagen en vez de un error genérico. */
const FRAMING_RELATED: ExtractionErrorCode[] = [
  "CARD_NOT_DETECTED",
  "BARCODE_NOT_DETECTED",
  "BARCODE_DECODE_FAILED",
  "OCR_LOW_CONFIDENCE",
];

/**
 * Estado y disparo de la extracción local de datos de un documento.
 * Puede ejecutarse con solo el frente, solo el reverso, o ambos: cada llamada
 * vuelve a intentar la extracción con lo disponible y fusiona el resultado.
 */
export function useIdExtraction<T>(
  runExtraction: (input: ExtractionInput) => Promise<ExtractionResult<T>>,
  applyData: ApplyData<T>,
) {
  const [status, setStatus] = useState<OcrStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [suggestReadjust, setSuggestReadjust] = useState(false);

  const trigger = useCallback(
    async (frontImage?: string, backImage?: string) => {
      if (!frontImage && !backImage) return;
      setStatus("extracting");
      setMessage(null);
      setSuggestReadjust(false);
      try {
        const result = await runExtraction({ frontImage, backImage });
        const readjust = Boolean(
          result.errorCode && FRAMING_RELATED.includes(result.errorCode),
        );

        if (result.status === "error") {
          setStatus("error");
          setMessage(result.message ?? GENERIC_FAILURE);
          setSuggestReadjust(readjust);
          return;
        }
        if (result.status === "notConfigured") {
          setStatus("notConfigured");
          setMessage(result.message ?? null);
          return;
        }

        applyData(
          result.data,
          result.fieldsDetected,
          result.fieldSources ?? {},
        );
        setStatus(result.status);
        setSuggestReadjust(result.status === "partial" && readjust);
        setMessage(
          result.message ??
            (result.status === "partial"
              ? "Algunos datos no se detectaron. Revísalos y complétalos."
              : null),
        );
      } catch {
        setStatus("error");
        setMessage(GENERIC_FAILURE);
      }
    },
    [runExtraction, applyData],
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setMessage(null);
    setSuggestReadjust(false);
  }, []);

  return { status, message, suggestReadjust, trigger, reset };
}
