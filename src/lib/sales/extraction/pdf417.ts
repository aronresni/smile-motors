/**
 * Decodificación local del PDF417 (reverso de la licencia de EE. UU.).
 * NUNCA sale del dispositivo — ni la imagen ni el contenido decodificado.
 *
 * Orden de prioridad (se detiene en el primer éxito):
 *   1. ZXing-C++ / WASM (`pdf417-wasm.ts`) — decodificador PRIMARIO, puerto
 *      real del motor C++ de ZXing, mucho más robusto frente a fotos reales
 *      (ruido, perspectiva, compresión) que una reimplementación en JS.
 *      Imagen completa primero SIEMPRE; región candidata como optimización.
 *   2. `@zxing/library` (JS puro) — RESPALDO si el WASM no está disponible
 *      o no decodificó. Multi-pase (resoluciones/contraste/umbral adaptativo,
 *      región, rotación) — cubre casos donde el WASM también falla.
 *   3. Si ambos fallan: quien llama (`buyer-extraction.ts`) sigue con OCR del
 *      frente — nunca se trata como error irrecuperable aquí.
 */
import {
  binarizeAdaptive,
  locateBarcodeRegion,
  toGrayscaleRaster,
  type GrayscaleRaster,
  type PixelRect,
} from "@/lib/sales/extraction/image-preprocess";
import { decodePdf417Wasm } from "@/lib/sales/extraction/pdf417-wasm";
import type { Pdf417AttemptDebug } from "@/lib/sales/types";

export interface Pdf417DecodeResult {
  text: string | null;
  /** ¿Se localizó una región de código recortada (la haya usado o no)? */
  regionDetected: boolean;
  /** Rectángulo detectado (coordenadas de la imagen original), para el
   * overlay "REGIÓN DETECTADA" del panel de desarrollo. */
  regionRect: PixelRect | null;
  attempts: Pdf417AttemptDebug[];
  /** Qué decodificador resolvió el código (si alguno). */
  decoder: "zxing-wasm" | "zxing-js" | null;
}

type Zxing = typeof import("@zxing/library");

function tryDecodeJs(zxing: Zxing, raster: GrayscaleRaster): string | null {
  const {
    PDF417Reader,
    RGBLuminanceSource,
    HybridBinarizer,
    BinaryBitmap,
    DecodeHintType,
    BarcodeFormat,
  } = zxing;
  const hints = new Map();
  hints.set(DecodeHintType.TRY_HARDER, true);
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.PDF_417]);

  try {
    const source = new RGBLuminanceSource(raster.gray, raster.width, raster.height);
    const bitmap = new BinaryBitmap(new HybridBinarizer(source));
    const result = new PDF417Reader().decode(bitmap, hints);
    const text = result?.getText?.();
    return text && text.length > 20 ? text : null;
  } catch {
    // NotFoundException / FormatException / ChecksumException → siguiente pase
    return null;
  }
}

interface PassSpec {
  name: string;
  sourceRect?: PixelRect;
  maxDim: number;
  minDim: number;
  contrast: number;
  rotation?: 0 | 90 | 180 | 270;
  adaptive?: boolean;
}

async function runJsPass(
  zxing: Zxing,
  dataUrl: string,
  spec: PassSpec,
): Promise<{ text: string | null; attempt: Pdf417AttemptDebug }> {
  let raster: GrayscaleRaster;
  try {
    raster = await toGrayscaleRaster(dataUrl, {
      maxDim: spec.maxDim,
      minDim: spec.minDim,
      contrast: spec.contrast,
      rotation: spec.rotation ?? 0,
      sourceRect: spec.sourceRect,
    });
  } catch {
    return {
      text: null,
      attempt: {
        pass: spec.name, width: 0, height: 0,
        rotation: spec.rotation ?? 0, success: false, decoder: "zxing-js",
      },
    };
  }
  if (spec.adaptive) raster = binarizeAdaptive(raster);

  const text = tryDecodeJs(zxing, raster);
  return {
    text,
    attempt: {
      pass: spec.name,
      width: raster.width,
      height: raster.height,
      rotation: spec.rotation ?? 0,
      success: Boolean(text),
      decoder: "zxing-js",
    },
  };
}

/** Respaldo en JS puro (`@zxing/library`) — solo si el WASM falló/no cargó. */
async function decodePdf417Js(
  dataUrl: string,
  region: PixelRect | null,
): Promise<{ text: string | null; attempts: Pdf417AttemptDebug[] }> {
  const attempts: Pdf417AttemptDebug[] = [];
  let zxing: Zxing;
  try {
    zxing = await import("@zxing/library");
  } catch {
    return { text: null, attempts };
  }

  const wholeImagePasses: PassSpec[] = [
    { name: "js:whole:standard", maxDim: 2400, minDim: 1300, contrast: 1 },
    { name: "js:whole:contrast", maxDim: 2400, minDim: 1300, contrast: 1.5 },
    { name: "js:whole:adaptive", maxDim: 2200, minDim: 1200, contrast: 1, adaptive: true },
  ];
  for (const spec of wholeImagePasses) {
    const { text, attempt } = await runJsPass(zxing, dataUrl, spec);
    attempts.push(attempt);
    if (text) return { text, attempts };
  }

  if (region) {
    const regionPasses: PassSpec[] = [
      { name: "js:region:standard", sourceRect: region, maxDim: 2200, minDim: 900, contrast: 1 },
      { name: "js:region:adaptive", sourceRect: region, maxDim: 2000, minDim: 900, contrast: 1, adaptive: true },
      { name: "js:region:upscale-2x", sourceRect: region, maxDim: 3600, minDim: 1800, contrast: 1.2 },
    ];
    for (const spec of regionPasses) {
      const { text, attempt } = await runJsPass(zxing, dataUrl, spec);
      attempts.push(attempt);
      if (text) return { text, attempts };
    }
  }

  // Último recurso: rotaciones. `RGBLuminanceSource` no rota por sí sola.
  const rotations: (90 | 180 | 270)[] = [90, 180, 270];
  for (const rotation of rotations) {
    const spec: PassSpec = { name: `js:whole:rotate-${rotation}`, maxDim: 2400, minDim: 1300, contrast: 1.2, rotation };
    const { text, attempt } = await runJsPass(zxing, dataUrl, spec);
    attempts.push(attempt);
    if (text) return { text, attempts };

    if (region) {
      const regionSpec: PassSpec = {
        name: `js:region:rotate-${rotation}`, sourceRect: region, maxDim: 2200, minDim: 900, contrast: 1.2, rotation,
      };
      const regionAttempt = await runJsPass(zxing, dataUrl, regionSpec);
      attempts.push(regionAttempt.attempt);
      if (regionAttempt.text) return { text: regionAttempt.text, attempts };
    }
  }

  return { text: null, attempts };
}

/** Devuelve el string crudo del PDF417 (o null) + un registro de intentos. */
export async function decodePdf417(dataUrl: string): Promise<Pdf417DecodeResult> {
  let region: PixelRect | null = null;
  try {
    region = await locateBarcodeRegion(dataUrl);
  } catch {
    region = null;
  }

  // 1) Primario: ZXing-C++/WASM. Imagen completa siempre primero.
  const wasm = await decodePdf417Wasm(dataUrl, region);
  if (wasm.text) {
    return {
      text: wasm.text,
      regionDetected: Boolean(region),
      regionRect: region,
      attempts: wasm.attempts,
      decoder: "zxing-wasm",
    };
  }

  // 2) Respaldo: `@zxing/library` (JS puro), multi-pase.
  const js = await decodePdf417Js(dataUrl, region);
  return {
    text: js.text,
    regionDetected: Boolean(region),
    regionRect: region,
    attempts: [...wasm.attempts, ...js.attempts],
    decoder: js.text ? "zxing-js" : null,
  };
}
