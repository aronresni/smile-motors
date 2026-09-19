/**
 * Modelo de datos del flujo "Nueva venta" (solo frontend).
 *
 * Diseñado para mapear luego a entidades relacionales:
 *   sales · sale_buyers · sale_units · sale_extras · sale_cuba_recipient ·
 *   sale_deliveries · sale_payments · sale_documents
 *
 * Nada de esto se persiste todavía.
 */

export type OperationType = "cuba" | "usa" | "local";

export type DocumentSide = "front" | "back";

/* --------------------------------------------------------------------------
 * Subida y edición de documentos (licencia / carné)
 * ------------------------------------------------------------------------ */
export type DocumentUploadStatus =
  | "idle"
  | "uploading"
  | "editing"
  | "ready"
  | "error";

export interface DocumentUploadState {
  status: DocumentUploadStatus;
  /** Imagen final (recortada/rotada) como data URL. No se sube en esta fase. */
  dataUrl: string | null;
  fileName: string | null;
  /** Imagen original sin editar, para poder re-recortar. */
  originalDataUrl: string | null;
  error: string | null;
}

export function emptyDocument(): DocumentUploadState {
  return {
    status: "idle",
    dataUrl: null,
    fileName: null,
    originalDataUrl: null,
    error: null,
  };
}

/* --------------------------------------------------------------------------
 * Extracción automática de datos del documento (OCR) — contrato de frontend
 * ------------------------------------------------------------------------ */
export type OcrStatus =
  | "idle"
  | "uploading"
  | "editing"
  | "extracting"
  | "success"
  | "partial"
  | "error"
  | "notConfigured";

/** Datos que un documento de identidad de comprador (licencia US) podría dar. */
export interface ExtractedDocumentData {
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string; // ISO yyyy-mm-dd
  documentNumber?: string;
  expirationDate?: string; // ISO yyyy-mm-dd
  addressLine1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
}

/** Datos que un carné de identidad cubano podría dar (reglas distintas). */
export interface ExtractedRecipientData {
  fullName?: string;
  identityNumber?: string;
  dateOfBirth?: string; // ISO yyyy-mm-dd
  address?: string;
  /** Metadatos opcionales de identidad — NO se aplican a campos operativos. */
  expirationDate?: string; // ISO yyyy-mm-dd
  registryProvince?: string;
  sex?: "M" | "F";
}

/**
 * De dónde salió un campo autocompletado (depuración / revisión).
 * `mrz-back` = zona legible por máquina del reverso del carné cubano
 * (fuente estructurada de alta confianza, análoga al PDF417 en EE. UU.).
 */
export type ExtractionFieldSource =
  | "pdf417"
  | "mrz-back"
  | "ocr-front"
  | "ocr-back";

/** Clasificación interna del motivo de fallo (el mensaje al usuario es simple). */
export type ExtractionErrorCode =
  | "CARD_NOT_DETECTED"
  | "BARCODE_NOT_DETECTED"
  | "BARCODE_DECODE_FAILED"
  | "OCR_FAILED"
  | "OCR_LOW_CONFIDENCE"
  | "STRUCTURED_PARSE_FAILED"
  | "UNSUPPORTED_DOCUMENT"
  /** El motor OCR (Tesseract.js) no pudo inicializarse/correr — distinto de
   * "corrió pero no encontró nada" (`OCR_FAILED`). Nunca se disfraza de
   * BARCODE_DECODE_FAILED aunque el PDF417 también haya fallado. */
  | "OCR_INIT_FAILED";

/** Un intento de decodificación PDF417 (para el modo debug, nunca en producción). */
export interface Pdf417AttemptDebug {
  pass: string;
  width: number;
  height: number;
  rotation: number;
  success: boolean;
  /** Qué motor hizo este intento — permite ver en el panel debug si el
   * primario (ZXing-C++/WASM) o el respaldo (ZXing JS) fue el que decodificó. */
  decoder: "zxing-wasm" | "zxing-js";
}

/**
 * Diagnóstico de una corrida de extracción. Se adjunta SOLO cuando el modo
 * debug de desarrollo está activo (ver `extraction/debug.ts`). Nunca incluye
 * imágenes/base64 ni el documento completo; el preview de texto OCR se trunca.
 */
export interface ExtractionDebugInfo {
  documentType: "us-license" | "cuban-id";
  originalDimensions: { width: number; height: number } | null;
  processedDimensions: { width: number; height: number } | null;
  regionDetected: boolean;
  /** Rectángulo de la región de código/MRZ detectada, en coordenadas de la
   * imagen ORIGINAL — permite dibujar el overlay "REGIÓN DETECTADA" en el
   * panel de desarrollo. `null` si no se detectó ninguna región. */
  regionRect?: { x: number; y: number; width: number; height: number } | null;
  pdf417Attempts?: Pdf417AttemptDebug[];
  pdf417Success?: boolean;
  /** Qué decodificador resolvió el PDF417 (si alguno). */
  pdf417Decoder?: "zxing-wasm" | "zxing-js" | null;
  ocrConfidence?: number;
  /** El motor OCR falló al inicializar/correr (ver `OCR_INIT_FAILED`) — texto
   * del error interno, NUNCA mostrado al usuario, solo para depuración. */
  ocrError?: string;
  /** Primeros ~160 caracteres del texto OCR crudo, solo para depuración local. */
  rawOcrTextPreview?: string;
  parsedFields: string[];
  fieldSource: Partial<Record<string, ExtractionFieldSource>>;
  fieldConfidence: Partial<Record<string, number>>;
}

export interface ExtractionResult<T> {
  status: Extract<OcrStatus, "success" | "partial" | "error" | "notConfigured">;
  data: T;
  /** Confianza global 0..1. */
  confidence: number;
  fieldsDetected: string[];
  /** Origen por campo. Opcional para no romper consumidores previos. */
  fieldSources?: Partial<Record<string, ExtractionFieldSource>>;
  message?: string;
  /** Motivo interno del resultado (para telemetría/depuración; NO se muestra crudo). */
  errorCode?: ExtractionErrorCode;
  /** Solo presente en desarrollo con el modo debug activo. */
  debug?: ExtractionDebugInfo;
}

/* --------------------------------------------------------------------------
 * Personas
 * ------------------------------------------------------------------------ */
export interface BuyerFormData {
  documentFront: DocumentUploadState;
  documentBack: DocumentUploadState;
  firstName: string;
  lastName: string;
  dateOfBirth: string; // ISO yyyy-mm-dd | ""
  documentNumber: string;
  documentExpiration: string; // ISO yyyy-mm-dd | ""
  phone: string;
  email: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string; // código de estado US
  postalCode: string;
}

export interface CoBuyerFormData {
  /** Opcionales: el ID del co-buyer no es obligatorio. */
  documentFront?: DocumentUploadState;
  documentBack?: DocumentUploadState;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  documentNumber: string;
  phone: string;
  email: string;
}

/* --------------------------------------------------------------------------
 * Unidades y extras
 * ------------------------------------------------------------------------ */
export interface SaleUnitFormData {
  /** id local del formulario (no de base de datos). */
  key: string;
  catalogModelId: string | null;
  modelName: string;
  variantId: string | null;
  variantLabel: string;
  listPriceCents: number | null;
  agreedPriceCents: number;
}

export interface SaleExtraFormData {
  key: string;
  description: string;
  quantity: number;
  unitAmountCents: number;
}

/* --------------------------------------------------------------------------
 * Destinatario en Cuba (persona distinta del comprador)
 * ------------------------------------------------------------------------ */
export interface CubaRecipientFormData {
  documentFront: DocumentUploadState;
  documentBack: DocumentUploadState;
  fullName: string;
  identityNumber: string; // Carné de Identidad (CI)
  deliveryAddress: string;
  municipality: string;
  province: string;
  phonePrimary: string; // con +53
  phoneSecondary: string; // con +53, opcional
}

/* --------------------------------------------------------------------------
 * Logística
 * ------------------------------------------------------------------------ */
export type DeliveryMethod = "home_delivery" | "pickup_point";

export interface DeliveryFormData {
  method: DeliveryMethod | null;
  reference: string; // punto de recogida / referencia adicional
}

/* --------------------------------------------------------------------------
 * Pagos (sin procesamiento real)
 * ------------------------------------------------------------------------ */
export type PaymentKind = "card" | "zelle" | "financing";

export type PaymentDraftStatus = "pending_integration" | "recorded";

export interface PaymentDraft {
  key: string;
  kind: PaymentKind;
  amountCents: number;
  reference: string;
  date: string; // ISO yyyy-mm-dd | ""
  notes: string;
  receipt: DocumentUploadState | null;
  status: PaymentDraftStatus;
}

/* --------------------------------------------------------------------------
 * Compartir comisión
 * ------------------------------------------------------------------------ */
export interface CommissionSharingDraft {
  enabled: boolean;
  /** id del otro vendedor — se elegirá cuando exista el backend. */
  partnerSellerId: string | null;
}

/* --------------------------------------------------------------------------
 * Borrador completo de la venta
 * ------------------------------------------------------------------------ */
export interface SaleDraft {
  operationType: OperationType;
  sellerId: string;
  sellerName: string;
  saleDate: string; // ISO yyyy-mm-dd
  commissionSharing: CommissionSharingDraft;
  buyer: BuyerFormData;
  coBuyer: CoBuyerFormData | null;
  units: SaleUnitFormData[];
  extras: SaleExtraFormData[];
  cubaRecipient: CubaRecipientFormData;
  delivery: DeliveryFormData;
  internalNotes: string;
  payments: PaymentDraft[];
}
