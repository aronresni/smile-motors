/**
 * Worker de Tesseract.js cacheado (uno por idioma).
 *
 * PRIVACIDAD: el reconocimiento ocurre 100% en el dispositivo (WebAssembly en
 * un Web Worker) — la imagen NUNCA se envía a ningún servicio. Por defecto,
 * Tesseract.js descarga el script del worker, el núcleo WASM y los datos de
 * idioma desde el CDN de jsdelivr la PRIMERA vez que corre — eso rompe el
 * requisito de "extracción 100% local" en cualquier entorno sin acceso a ese
 * CDN (o con CSP restrictiva). Por eso `workerPath`/`corePath`/`langPath`
 * apuntan aquí a copias servidas por esta misma app desde `/public/tesseract`
 * (ver `public/tesseract/README.md` para cómo se generaron). Ningún archivo
 * de OCR sale a un CDN de terceros en tiempo de ejecución.
 */
import type { Worker } from "tesseract.js";

const workers = new Map<string, Promise<Worker>>();
let idleTimer: ReturnType<typeof setTimeout> | null = null;
const IDLE_MS = 90_000;

/** Idiomas con `.traineddata` autohospedado en `/public/tesseract/lang-data`. */
const SUPPORTED_LANGS = new Set(["eng", "spa"]);

async function createLangWorker(lang: string): Promise<Worker> {
  if (!SUPPORTED_LANGS.has(lang)) {
    throw new Error(`Idioma OCR sin datos autohospedados: ${lang}`);
  }
  const { createWorker } = await import("tesseract.js");
  return createWorker(lang, undefined, {
    workerPath: "/tesseract/worker.min.js",
    corePath: "/tesseract/core",
    langPath: "/tesseract/lang-data",
    // El worker script de tesseract.js decide el nombre de archivo del
    // .traineddata (ver worker-script/index.js); con `gzip` en su valor por
    // defecto (true) pide "<langPath>/<lang>.traineddata.gz", que es
    // exactamente el archivo que autohospedamos.
  });
}

function getWorker(lang: string): Promise<Worker> {
  let worker = workers.get(lang);
  if (!worker) {
    worker = createLangWorker(lang);
    workers.set(lang, worker);
  }
  return worker;
}

function scheduleIdleTerminate() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    void terminateOcrWorkers();
  }, IDLE_MS);
}

export interface OcrResult {
  text: string;
  /** 0..1 */
  confidence: number;
}

export interface RecognizeOptions {
  /**
   * Restringe el reconocimiento a este conjunto de caracteres (p. ej. solo
   * dígitos, o `A-Z0-9<` para una zona legible por máquina). Mejora mucho la
   * precisión en campos numéricos/estructurados frente al OCR de texto libre.
   * Se limpia el worker al conjunto de idioma normal después de usarlo, ya
   * que el worker se reutiliza entre llamadas.
   */
  charWhitelist?: string;
}

export async function recognizeText(
  image: string,
  lang = "eng",
  options: RecognizeOptions = {},
): Promise<OcrResult> {
  const worker = await getWorker(lang);
  if (options.charWhitelist) {
    await worker.setParameters({ tessedit_char_whitelist: options.charWhitelist });
  }
  try {
    const { data } = await worker.recognize(image);
    const confidence = Math.max(0, Math.min(1, (data.confidence ?? 0) / 100));
    return { text: data.text ?? "", confidence };
  } finally {
    // El worker se cachea y reutiliza: restaurar el alfabeto completo para
    // que la próxima llamada (texto libre) no quede restringida.
    if (options.charWhitelist) {
      await worker.setParameters({ tessedit_char_whitelist: "" });
    }
    scheduleIdleTerminate();
  }
}

/** Libera memoria de los workers (se llama solo tras inactividad). */
export async function terminateOcrWorkers(): Promise<void> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  const pending = Array.from(workers.values());
  workers.clear();
  await Promise.allSettled(
    pending.map(async (p) => {
      try {
        const w = await p;
        await w.terminate();
      } catch {
        /* noop */
      }
    }),
  );
}
