/**
 * Decodificador PDF417 PRIMARIO: ZXing-C++ compilado a WebAssembly
 * (`zxing-wasm`, paquete `./reader` — solo lectura, sin el escritor). Es un
 * puerto directo del motor C++ real de ZXing (mucho más robusto frente a
 * fotos reales con ruido/perspectiva que la reimplementación en JS puro de
 * `@zxing/library`) — ver `pdf417.ts` para el orden de prioridad completo
 * (WASM → `@zxing/library` JS → OCR del frente).
 *
 * 100% local: por defecto `zxing-wasm` carga su `.wasm` desde el CDN de
 * jsDelivr la primera vez — aquí se fuerza `locateFile` a servirlo desde
 * `/zxing/zxing_reader.wasm` (esta misma app, ver `public/zxing/README.md`).
 * Ningún archivo sale a un CDN de terceros en tiempo de ejecución.
 */
import { toRgbaImageData, type PixelRect } from "@/lib/sales/extraction/image-preprocess";
import type { Pdf417AttemptDebug } from "@/lib/sales/types";

let configured = false;

async function ensureConfigured() {
  if (configured) return;
  const { prepareZXingModule } = await import("zxing-wasm/reader");
  prepareZXingModule({
    overrides: {
      // Emscripten llama a `locateFile(filename, defaultPrefix)`; se ignora
      // el prefijo por defecto (apuntaría al CDN) y se sirve desde `/zxing/`.
      locateFile: (path: string) => `/zxing/${path}`,
    },
  });
  configured = true;
}

export interface Pdf417WasmDecodeResult {
  text: string | null;
  attempts: Pdf417AttemptDebug[];
}

/**
 * Intenta decodificar un PDF417 con ZXing-C++/WASM. Pases deliberadamente
 * pocos — `tryHarder`/`tryRotate`/`tryDownscale` del propio motor C++ ya
 * cubren mucho de lo que antes requería multiplicar pases en JS:
 *   1. Imagen completa (siempre se intenta primero, nunca se salta).
 *   2. Región candidata (si `locateBarcodeRegion` encontró una) — optimización
 *      para fotos con fondo amplio, NUNCA obligatoria.
 */
export async function decodePdf417Wasm(
  dataUrl: string,
  region: PixelRect | null,
): Promise<Pdf417WasmDecodeResult> {
  const attempts: Pdf417AttemptDebug[] = [];

  let readBarcodes: typeof import("zxing-wasm/reader").readBarcodes;
  try {
    await ensureConfigured();
    ({ readBarcodes } = await import("zxing-wasm/reader"));
  } catch {
    return { text: null, attempts };
  }

  const passes: { name: string; sourceRect?: PixelRect; maxDim: number }[] = [
    { name: "wasm:whole", maxDim: 2800 },
  ];
  if (region) {
    passes.push({ name: "wasm:region", sourceRect: region, maxDim: 2400 });
  }

  for (const pass of passes) {
    try {
      const imageData = await toRgbaImageData(dataUrl, {
        maxDim: pass.maxDim,
        sourceRect: pass.sourceRect,
      });
      const results = await readBarcodes(imageData, {
        formats: ["PDF417"],
        tryHarder: true,
        maxNumberOfSymbols: 1,
      });
      const text = results[0]?.text || null;
      const success = Boolean(text && text.length > 20);
      attempts.push({
        pass: pass.name,
        width: imageData.width,
        height: imageData.height,
        rotation: 0,
        success,
        decoder: "zxing-wasm",
      });
      if (success) return { text, attempts };
    } catch {
      attempts.push({
        pass: pass.name,
        width: 0,
        height: 0,
        rotation: 0,
        success: false,
        decoder: "zxing-wasm",
      });
    }
  }

  return { text: null, attempts };
}
