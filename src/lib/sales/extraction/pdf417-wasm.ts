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
import {
  getImageDimensions,
  toRgbaImageData,
  type PixelRect,
} from "@/lib/sales/extraction/image-preprocess";
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
 *   3. Región AMPLIADA 2×/3× (con y sin enfoque) y, en fotos pequeñas, la
 *      imagen completa 3× — para fotos comprimidas (galería, WhatsApp) en las
 *      que el código queda a ~1 px por módulo: sin ampliar, ningún
 *      decodificador lo resuelve (confirmado con una licencia real).
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

  const passes: {
    name: string;
    sourceRect?: PixelRect;
    maxDim: number;
    upscale?: number;
    sharpen?: boolean;
  }[] = [{ name: "wasm:whole", maxDim: 2800 }];
  if (region) {
    passes.push(
      { name: "wasm:region", sourceRect: region, maxDim: 2400 },
      { name: "wasm:region-2x-sharpen", sourceRect: region, maxDim: 4000, upscale: 2, sharpen: true },
      { name: "wasm:region-3x", sourceRect: region, maxDim: 4000, upscale: 3 },
      { name: "wasm:region-3x-sharpen", sourceRect: region, maxDim: 4000, upscale: 3, sharpen: true },
    );
  }
  // Imagen completa ampliada: solo si es pequeña (una foto grande ya tiene
  // resolución de sobra y ampliarla solo gastaría memoria).
  const dims = await getImageDimensions(dataUrl).catch(() => null);
  if (dims && Math.max(dims.width, dims.height) <= 1800) {
    passes.push({ name: "wasm:whole-3x-sharpen", maxDim: 5400, upscale: 3, sharpen: true });
  }

  for (const pass of passes) {
    try {
      const imageData = await toRgbaImageData(dataUrl, {
        maxDim: pass.maxDim,
        sourceRect: pass.sourceRect,
        upscale: pass.upscale,
        sharpen: pass.sharpen,
      });
      const results = await readBarcodes(imageData, {
        formats: ["PDF417"],
        tryHarder: true,
        maxNumberOfSymbols: 1,
        // "Plain": los separadores AAMVA (LF/RS/CR) llegan como caracteres de
        // control. El modo por defecto (HRI) los convierte en el texto
        // literal "<LF>"/"<RS>" cuando el símbolo tiene bytes de control, y el
        // parser no encontraba ningún campo (licencia real de Florida).
        textMode: "Plain",
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
