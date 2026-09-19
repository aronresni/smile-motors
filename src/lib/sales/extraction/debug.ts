/**
 * Modo debug de extracción — SOLO desarrollo, y solo si se activa
 * explícitamente (opt-in). Nunca se activa solo. En producción esta función
 * siempre devuelve `false` sin importar el flag.
 *
 * Activar en la consola del navegador:
 *   localStorage.setItem('motods:ocr-debug', '1')
 * Desactivar:
 *   localStorage.removeItem('motods:ocr-debug')
 *
 * El resumen impreso NUNCA incluye: imágenes/base64, el documento completo,
 * ni valores de campos (solo sus NOMBRES). El texto OCR crudo (si se
 * necesita) queda en `debug.rawOcrTextPreview` del resultado devuelto para
 * que el desarrollador lo inspeccione a propósito — no se imprime solo.
 */
import type { ExtractionDebugInfo } from "@/lib/sales/types";

export function isExtractionDebugEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem("motods:ocr-debug") === "1";
  } catch {
    return false;
  }
}

/** Resumen PII-safe: dimensiones, conteos, booleanos, nombres de campo — nunca valores. */
export function logDebugSummary(label: string, debug: ExtractionDebugInfo): void {
  if (!isExtractionDebugEnabled()) return;
  console.debug(`[ocr-debug] ${label}`, {
    documentType: debug.documentType,
    originalDimensions: debug.originalDimensions,
    processedDimensions: debug.processedDimensions,
    regionDetected: debug.regionDetected,
    pdf417Attempts: debug.pdf417Attempts?.map((a) => ({
      pass: a.pass,
      size: `${a.width}x${a.height}`,
      rotation: a.rotation,
      success: a.success,
    })),
    pdf417Success: debug.pdf417Success,
    ocrConfidence: debug.ocrConfidence,
    parsedFieldNames: debug.parsedFields,
    fieldSource: debug.fieldSource,
    fieldConfidence: debug.fieldConfidence,
  });
}
