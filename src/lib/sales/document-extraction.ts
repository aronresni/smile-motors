/**
 * DocumentExtractionService — fachada.
 *
 * La lectura de documentos ocurre 100% en el dispositivo del vendedor
 * (PDF417 con ZXing + OCR con Tesseract.js WASM). Las imágenes NUNCA se
 * envían a un servicio externo.
 *
 * Los motores pesados se cargan de forma diferida (`import()` dinámico), así
 * que no entran en el bundle del panel ni del formulario: solo se descargan
 * cuando el vendedor analiza un documento.
 */
import type {
  ExtractedDocumentData,
  ExtractedRecipientData,
  ExtractionResult,
} from "@/lib/sales/types";

export interface ExtractBuyerIdInput {
  frontImage?: string; // data URL
  backImage?: string;
}

export interface ExtractRecipientIdInput {
  frontImage?: string;
  backImage?: string;
}

/** Licencia / ID de comprador (EE. UU.): PDF417 → AAMVA → OCR de respaldo. */
export async function extractBuyerId(
  input: ExtractBuyerIdInput,
): Promise<ExtractionResult<ExtractedDocumentData>> {
  const { runBuyerExtraction } = await import(
    "@/lib/sales/extraction/buyer-extraction"
  );
  return runBuyerExtraction(input);
}

/** Carné de identidad cubano del receptor: OCR local + parser específico. */
export async function extractRecipientId(
  input: ExtractRecipientIdInput,
): Promise<ExtractionResult<ExtractedRecipientData>> {
  const { runRecipientExtraction } = await import(
    "@/lib/sales/extraction/recipient-extraction"
  );
  return runRecipientExtraction(input);
}
