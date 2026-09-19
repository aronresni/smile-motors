/**
 * Pipeline de extracción del COMPRADOR (licencia / ID de EE. UU.).
 *
 *   PDF417 (reverso) → AAMVA
 *          ↓ (campos faltantes)
 *   OCR local (frente, o reverso si no hay frente)
 *          ↓ (si aún falta el N.º de documento)
 *   OCR de respaldo con alfabeto restringido sobre el mismo lado
 *          ↓
 *   fusión → ExtractedDocumentData
 *
 * Prioridad de origen: pdf417 > ocr-back > ocr-front. Un valor de OCR puede
 * ser reemplazado por PDF417; nunca se toca un valor editado por el vendedor
 * (eso se controla en la sección del formulario).
 */
import type {
  ExtractedDocumentData,
  ExtractionDebugInfo,
  ExtractionFieldSource,
  ExtractionResult,
} from "@/lib/sales/types";
import { decodePdf417 } from "@/lib/sales/extraction/pdf417";
import { parseAamva } from "@/lib/sales/extraction/aamva";
import { recognizeText } from "@/lib/sales/extraction/ocr-worker";
import { getImageDimensions, toOcrDataUrl } from "@/lib/sales/extraction/image-preprocess";
import { parseUsLicenseText } from "@/lib/sales/extraction/buyer-ocr-parse";
import { isExtractionDebugEnabled, logDebugSummary } from "@/lib/sales/extraction/debug";

export interface ExtractionInput {
  frontImage?: string;
  backImage?: string;
}

const TARGET_FIELDS: (keyof ExtractedDocumentData)[] = [
  "firstName",
  "lastName",
  "dateOfBirth",
  "documentNumber",
  "expirationDate",
  "addressLine1",
  "city",
  "state",
  "postalCode",
];
const CORE_FIELDS: (keyof ExtractedDocumentData)[] = [
  "firstName",
  "lastName",
  "documentNumber",
];

function fail(
  message: string,
  errorCode: ExtractionResult<ExtractedDocumentData>["errorCode"],
): ExtractionResult<ExtractedDocumentData> {
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

export async function runBuyerExtraction(
  input: ExtractionInput,
): Promise<ExtractionResult<ExtractedDocumentData>> {
  const { frontImage, backImage } = input;
  if (!frontImage && !backImage) {
    return fail(
      "No pudimos leer los datos automáticamente. Puedes completarlos manualmente.",
      "UNSUPPORTED_DOCUMENT",
    );
  }

  const data: ExtractedDocumentData = {};
  const fieldSources: Partial<Record<string, ExtractionFieldSource>> = {};
  const fieldConfidenceAll: Partial<Record<string, number>> = {};
  const confidences: number[] = [];
  let pdf417Ok = false;
  let pdf417Attempted = false;
  let ocrRan = false;
  let ocrCharCount = 0;
  let ocrError: string | null = null;
  let ocrParsedZeroFields = false;
  const debugEnabled = isExtractionDebugEnabled();
  let pdf417Debug: ExtractionDebugInfo["pdf417Attempts"];
  let pdf417Decoder: ExtractionDebugInfo["pdf417Decoder"] = null;
  let regionRect: ExtractionDebugInfo["regionRect"] = null;
  let rawOcrPreview: string | undefined;

  // 1) PDF417 en el reverso (primario) — ZXing-C++/WASM, con respaldo en JS
  //    puro si hace falta — ver pdf417.ts.
  if (backImage) {
    pdf417Attempted = true;
    try {
      const decoded = await decodePdf417(backImage);
      if (debugEnabled) pdf417Debug = decoded.attempts;
      pdf417Decoder = decoded.decoder;
      regionRect = decoded.regionRect;
      if (decoded.text) {
        const parsed = parseAamva(decoded.text);
        if (parsed) {
          pdf417Ok = true;
          for (const key of Object.keys(parsed.data) as (keyof ExtractedDocumentData)[]) {
            const value = parsed.data[key];
            if (value) {
              data[key] = value;
              fieldSources[key] = "pdf417";
              fieldConfidenceAll[key] = 0.97;
            }
          }
          confidences.push(0.97);
        }
      }
    } catch {
      /* seguimos con OCR */
    }
  }

  // 2) OCR de respaldo si faltan campos objetivo.
  const stillMissing = () => TARGET_FIELDS.some((f) => !data[f]);
  if (stillMissing()) {
    const ocrImage = frontImage ?? backImage;
    const source: ExtractionFieldSource = frontImage ? "ocr-front" : "ocr-back";
    if (ocrImage) {
      try {
        const working = await toOcrDataUrl(ocrImage);
        const { text, confidence } = await recognizeText(working, "eng");
        ocrRan = true;
        ocrCharCount = text.trim().length;
        if (debugEnabled) rawOcrPreview = text.slice(0, 600);
        const parsed = parseUsLicenseText(text, confidence);
        if (Object.keys(parsed.data).length === 0) ocrParsedZeroFields = true;
        for (const key of Object.keys(parsed.data) as (keyof ExtractedDocumentData)[]) {
          const value = parsed.data[key];
          if (value && !data[key]) {
            data[key] = value;
            fieldSources[key] = source;
            const c = parsed.fieldConfidence[key];
            if (typeof c === "number") {
              confidences.push(c);
              fieldConfidenceAll[key] = c;
            }
          }
        }

        // 3) Respaldo numérico: sin PDF417, el N.º de documento es el campo
        //    más sensible a confusiones letra/dígito del OCR de texto libre.
        //    Un segundo pase restringido a dígitos ayuda cuando el formato
        //    del documento es mayormente numérico. Nunca se aplica a nombres.
        if (!data.documentNumber) {
          try {
            const { text: digitsText } = await recognizeText(working, "eng", {
              charWhitelist: "0123456789",
            });
            const digitsOnly = digitsText.replace(/\D/g, "");
            if (digitsOnly.length >= 6 && digitsOnly.length <= 12) {
              data.documentNumber = digitsOnly;
              fieldSources.documentNumber = source;
              fieldConfidenceAll.documentNumber = 0.5;
              confidences.push(0.5);
            }
          } catch {
            /* respaldo best-effort */
          }
        }
      } catch (err) {
        // El OCR (inicialización del worker de Tesseract o el reconocimiento
        // en sí) falló por completo — se registra para no disfrazarlo de
        // BARCODE_DECODE_FAILED más abajo (ver selección de errorCode).
        ocrError = err instanceof Error ? err.message : String(err);
      }
    }
  }

  const fieldsDetected = Object.keys(data);
  const overall = confidences.length
    ? confidences.reduce((a, b) => a + b, 0) / confidences.length
    : 0;

  let debug: ExtractionDebugInfo | undefined;
  if (debugEnabled) {
    const dims = await getImageDimensions(backImage ?? frontImage ?? "").catch(() => null);
    debug = {
      documentType: "us-license",
      originalDimensions: dims,
      processedDimensions: dims,
      regionDetected: Boolean(regionRect),
      regionRect,
      pdf417Attempts: pdf417Debug,
      pdf417Success: pdf417Ok,
      pdf417Decoder: pdf417Ok ? pdf417Decoder : null,
      ocrConfidence: overall,
      ocrError: ocrError ?? undefined,
      rawOcrTextPreview: rawOcrPreview,
      parsedFields: fieldsDetected,
      fieldSource: fieldSources,
      fieldConfidence: fieldConfidenceAll,
    };
    logDebugSummary("buyer(us-license)", debug);
  }

  if (fieldsDetected.length === 0) {
    let code: ExtractionResult<ExtractedDocumentData>["errorCode"] = "OCR_FAILED";
    let message =
      "No pudimos leer los datos automáticamente. Puedes completarlos manualmente.";
    if (ocrError) {
      // El OCR (Tesseract) falló por completo — NUNCA se disfraza de
      // BARCODE_DECODE_FAILED, aunque el PDF417 también haya fallado.
      code = "OCR_INIT_FAILED";
      message =
        "No pudimos completar la lectura local del documento. Intenta de nuevo; si el problema continúa, completa los datos manualmente.";
    } else if (pdf417Attempted && !pdf417Ok && !ocrRan) {
      code = pdf417Debug?.length ? "BARCODE_DECODE_FAILED" : "BARCODE_NOT_DETECTED";
      message =
        "No pudimos leer el código del reverso. Intenta reajustar la imagen o tomar una foto más cerca, asegurando que el código ocupe la mayor parte del recorte y esté enfocado.";
    } else if (ocrRan && ocrCharCount < 12) {
      code = "OCR_FAILED";
      message =
        "No pudimos leer bien el documento. Prueba con una foto más clara, recta y con buena iluminación.";
    } else if (ocrRan && ocrParsedZeroFields) {
      code = "OCR_FAILED";
      message =
        "Leímos el documento pero no pudimos identificar los campos automáticamente. Puedes completarlos manualmente.";
    }
    return { ...fail(message, code), debug };
  }

  const gotCore = CORE_FIELDS.every((f) => Boolean(data[f]));
  const status: "success" | "partial" =
    gotCore && (pdf417Ok || overall >= 0.65) ? "success" : "partial";

  return {
    status,
    data,
    confidence: Number(overall.toFixed(2)),
    fieldsDetected,
    fieldSources,
    errorCode:
      status === "partial"
        ? pdf417Attempted && !pdf417Ok
          ? "BARCODE_DECODE_FAILED"
          : "OCR_LOW_CONFIDENCE"
        : undefined,
    message:
      status === "success"
        ? "Documento leído correctamente. Revisa los datos autocompletados."
        : "Completamos algunos datos del documento. Revisa la información restante.",
    debug,
  };
}
