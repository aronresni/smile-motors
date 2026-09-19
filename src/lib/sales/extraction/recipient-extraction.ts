/**
 * Pipeline de extracción del DESTINATARIO EN CUBA (carné de identidad).
 *
 *   MRZ-like (reverso, franja inferior) → identityNumber, fullName, sexo,
 *                                          fechas (fuente ESTRUCTURADA, prioritaria)
 *          ↓ (campos aún faltantes)
 *   OCR local etiquetado (frente, y reverso como respaldo) → complementa
 *          ↓ (si sigue sin N.º de identidad)
 *   OCR de respaldo con alfabeto solo-dígitos sobre el frente
 *
 * Sin AAMVA. NO se infiere nada del número de CI (ni fecha de nacimiento, ni
 * sexo, ni provincia/municipio a partir del propio número). El vendedor
 * completa siempre la información operativa de entrega (dirección,
 * municipio, provincia, teléfonos) a mano — nunca se autocompleta desde el
 * documento.
 */
import type {
  ExtractedRecipientData,
  ExtractionDebugInfo,
  ExtractionFieldSource,
  ExtractionResult,
} from "@/lib/sales/types";
import { recognizeText } from "@/lib/sales/extraction/ocr-worker";
import { getImageDimensions, toOcrDataUrl } from "@/lib/sales/extraction/image-preprocess";
import { parseCubanIdentityText } from "@/lib/sales/extraction/cuban-id-parse";
import { extractCubanMrz } from "@/lib/sales/extraction/cuban-mrz";
import { isExtractionDebugEnabled, logDebugSummary } from "@/lib/sales/extraction/debug";
import type { ExtractionInput } from "@/lib/sales/extraction/buyer-extraction";

function fail(
  message: string,
  errorCode: ExtractionResult<ExtractedRecipientData>["errorCode"],
): ExtractionResult<ExtractedRecipientData> {
  return {
    status: "error",
    data: {},
    confidence: 0,
    fieldsDetected: [],
    fieldSources: {},
    message,
    errorCode,
  };
}

export async function runRecipientExtraction(
  input: ExtractionInput,
): Promise<ExtractionResult<ExtractedRecipientData>> {
  const { frontImage, backImage } = input;
  if (!frontImage && !backImage) {
    return fail(
      "No pudimos leer los datos automáticamente. Puedes completarlos manualmente.",
      "UNSUPPORTED_DOCUMENT",
    );
  }

  const data: ExtractedRecipientData = {};
  const fieldSources: Partial<Record<string, ExtractionFieldSource>> = {};
  const fieldConfidenceAll: Partial<Record<string, number>> = {};
  const confidences: number[] = [];
  let ocrRan = false;
  let ocrCharCount = 0;
  let ocrError: string | null = null;
  let mrzRegionUsed = false;
  let mrzFieldCount = 0;
  let rawOcrPreview: string | undefined;

  const applyFields = (
    parsedData: ExtractedRecipientData,
    parsedConfidence: Partial<Record<keyof ExtractedRecipientData, number>>,
    source: ExtractionFieldSource,
  ) => {
    for (const key of Object.keys(parsedData) as (keyof ExtractedRecipientData)[]) {
      const value = parsedData[key];
      if (value === undefined || value === null || value === "") continue;
      if (data[key] !== undefined) continue; // el primero en escribir (mayor prioridad) gana
      // TS no infiere bien la unión de tipos de valor aquí; la asignación es segura
      // porque `value` proviene del mismo `key` de `ExtractedRecipientData`.
      (data as Record<string, unknown>)[key] = value;
      fieldSources[key] = source;
      const c = parsedConfidence[key];
      if (typeof c === "number") {
        confidences.push(c);
        fieldConfidenceAll[key] = c;
      }
    }
  };

  // 1) Zona legible por máquina del reverso — fuente estructurada primaria.
  if (backImage) {
    try {
      const mrz = await extractCubanMrz(backImage);
      mrzRegionUsed = mrz.regionUsed;
      mrzFieldCount = Object.keys(mrz.data).length;
      if (mrzFieldCount > 0) {
        applyFields(mrz.data, mrz.fieldConfidence, "mrz-back");
      }
    } catch {
      /* seguimos con OCR de texto libre */
    }
  }

  // 2) OCR etiquetado de texto libre (frente primero, reverso como respaldo).
  const passes: [string | undefined, ExtractionFieldSource][] = [
    [frontImage, "ocr-front"],
    [backImage, "ocr-back"],
  ];
  for (const [image, source] of passes) {
    if (!image) continue;
    try {
      const working = await toOcrDataUrl(image);
      const { text, confidence } = await recognizeText(working, "spa");
      ocrRan = true;
      ocrCharCount += text.trim().length;
      if (isExtractionDebugEnabled() && !rawOcrPreview) rawOcrPreview = text.slice(0, 600);
      const parsed = parseCubanIdentityText(text, confidence);
      applyFields(parsed.data, parsed.fieldConfidence, source);
    } catch (err) {
      // Se intenta el otro lado igualmente, pero el error se registra: si
      // NINGÚN lado corrió OCR, no se disfraza de STRUCTURED_PARSE_FAILED
      // más abajo (ver selección de errorCode).
      ocrError = err instanceof Error ? err.message : String(err);
    }
  }

  // 3) Respaldo numérico: si aún no hay N.º de identidad, un pase de OCR
  //    restringido a dígitos sobre el frente suele acertar donde el texto
  //    libre confunde dígitos con letras. Nunca se aplica a nombres.
  if (!data.identityNumber && frontImage) {
    try {
      const working = await toOcrDataUrl(frontImage, { contrast: 1.6 });
      const { text: digitsText } = await recognizeText(working, "eng", {
        charWhitelist: "0123456789",
      });
      const elevenDigits = /(\d{11})/.exec(digitsText.replace(/\s+/g, ""));
      if (elevenDigits) {
        data.identityNumber = elevenDigits[1];
        fieldSources.identityNumber = "ocr-front";
        fieldConfidenceAll.identityNumber = 0.6;
        confidences.push(0.6);
      }
    } catch {
      /* respaldo best-effort */
    }
  }

  const fieldsDetected = Object.keys(data);
  const overall = confidences.length
    ? confidences.reduce((a, b) => a + b, 0) / confidences.length
    : 0;

  let debug: ExtractionDebugInfo | undefined;
  if (isExtractionDebugEnabled()) {
    const dims = await getImageDimensions(backImage ?? frontImage ?? "").catch(() => null);
    debug = {
      documentType: "cuban-id",
      originalDimensions: dims,
      processedDimensions: dims,
      regionDetected: mrzRegionUsed,
      ocrConfidence: overall,
      ocrError: ocrError ?? undefined,
      rawOcrTextPreview: rawOcrPreview,
      parsedFields: fieldsDetected,
      fieldSource: fieldSources,
      fieldConfidence: fieldConfidenceAll,
    };
    logDebugSummary("recipient(cuban-id)", debug);
  }

  if (fieldsDetected.length === 0) {
    let code: ExtractionResult<ExtractedRecipientData>["errorCode"] = "STRUCTURED_PARSE_FAILED";
    let message = "No pudimos leer los datos automáticamente. Puedes completarlos manualmente.";
    if (ocrError && !ocrRan) {
      // El OCR falló por completo en ambos lados (no solo "no encontró
      // campos") — nunca se disfraza de STRUCTURED_PARSE_FAILED.
      code = "OCR_INIT_FAILED";
      message =
        "No pudimos completar la lectura local del documento. Intenta de nuevo; si el problema continúa, completa los datos manualmente.";
    } else if (ocrRan && ocrCharCount < 12) {
      code = "OCR_FAILED";
      message = "No pudimos leer bien el documento. Prueba con una foto más clara, recta y con buena iluminación.";
    }
    return { ...fail(message, code), debug };
  }

  const gotCore = Boolean(data.fullName && data.identityNumber);
  const status: "success" | "partial" =
    gotCore && (mrzFieldCount >= 2 || overall >= 0.55) ? "success" : "partial";

  return {
    status,
    data,
    confidence: Number(overall.toFixed(2)),
    fieldsDetected,
    fieldSources,
    errorCode: status === "partial" ? "OCR_LOW_CONFIDENCE" : undefined,
    message:
      status === "success"
        ? "Documento del destinatario leído correctamente. Revisa los datos."
        : "Detectamos algunos datos del destinatario. Completa la información restante.",
    debug,
  };
}
