/**
 * Prepara la foto que elige el vendedor ANTES de abrir el editor de recorte.
 * Solo cliente.
 *
 * Por qué existe (fallo real en iPhone/Safari, galería): la foto se leía con
 * `FileReader.readAsDataURL` y se pasaba como data URL de tamaño completo. Una
 * foto de la galería de un iPhone son 12–48 MP, así que eso significaba:
 *   1. una cadena base64 de 1,33× el archivo (10–40 MB) viva en memoria,
 *   2. esa misma cadena guardada OTRA VEZ en el estado del formulario
 *      (`originalDataUrl`) — y hay hasta seis documentos por venta,
 *   3. tres decodificaciones completas de la imagen (comprobación previa,
 *      `<img>` del recortador y `getCroppedImage`), a 4 bytes por píxel:
 *      192 MB de mapa de bits para una foto de 48 MP.
 * Safari en iOS aborta en silencio ahí: la decodificación falla, la
 * comprobación previa daba "formato no compatible" y el editor NO se abría —
 * la imagen "desaparecía" y no había manera de recortarla.
 *
 * Ahora la imagen se decodifica UNA vez (`createImageBitmap`, que en iOS usa
 * los decodificadores del sistema y por tanto también abre HEIC), se reduce
 * de inmediato a una imagen de trabajo manejable y de ahí en adelante todo
 * (editor, recorte, OCR) trabaja sobre un `blob:` URL pequeño. Nunca se crea
 * un data URL del original.
 */

export type PrepareImageErrorCode = "not_image" | "too_large" | "decode" | "canvas";

export class PrepareImageError extends Error {
  readonly code: PrepareImageErrorCode;
  constructor(code: PrepareImageErrorCode, message: string) {
    super(message);
    this.name = "PrepareImageError";
    this.code = code;
  }
}

/** Tope del archivo de origen. Holgado: lo que importa no es el peso del
 * archivo sino la imagen de trabajo, que siempre se reduce. */
export const MAX_FILE_MB = 30;
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;

/**
 * Imagen de trabajo: lado mayor y píxeles totales.
 *
 * 2600 px de lado mayor conservan de sobra lo que necesitan el PDF417 y el
 * OCR: con la tarjeta ocupando ~80 % del encuadre quedan ~2000 px sobre
 * 85,6 mm de tarjeta ≈ 23 px/mm, unos 4 px por módulo del PDF417 (el mínimo
 * práctico son 2). A cambio, el mapa de bits baja de 192 MB (48 MP) a 27 MB.
 */
export const MAX_WORKING_SIDE = 2600;
export const MAX_WORKING_PIXELS = 6_000_000;
/** Calidad de la imagen de trabajo. El recorte final se recomprime a 0,95
 * (`crop-image.ts`), que es lo que alimenta al PDF417/OCR. */
const WORKING_QUALITY = 0.92;

/** Tope de píxeles de un lienzo intermedio: Safari/iOS no dibuja lienzos de
 * más de ~16,7 MP (falla en silencio). */
const MAX_CANVAS_PIXELS = 16_000_000;

/** Una foto de iCloud que aún no está descargada, o elegida desde "Archivos",
 * puede llegar sin `type`. En ese caso decide la extensión. */
const IMAGE_EXTENSION = /\.(jpe?g|png|webp|heic|heif|gif|bmp|tiff?|avif)$/i;

const DECODE_TIMEOUT_MS = 25_000;

export function looksLikeImage(file: File): boolean {
  if (file.type) return file.type.startsWith("image/");
  return IMAGE_EXTENSION.test(file.name ?? "");
}

export interface PreparedImage {
  /** `blob:` URL de la imagen de trabajo. Quien la recibe se hace cargo de
   * liberarla con `URL.revokeObjectURL` cuando deje de usarla. */
  url: string;
  width: number;
  height: number;
  /** Tamaño del original, para saber si hubo reducción (diagnóstico). */
  sourceWidth: number;
  sourceHeight: number;
  bytes: number;
}

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  /** Libera el mapa de bits / el `blob:` URL del original cuanto antes.
   * Se puede llamar varias veces (se libera una sola). */
  release: () => void;
}

/** Envuelve una función para que solo se ejecute la primera vez. */
function once(fn: () => void): () => void {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    fn();
  };
}

function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(
      () =>
        finish(() => {
          img.src = "";
          reject(new PrepareImageError("decode", "Tiempo agotado al abrir la imagen"));
        }),
      DECODE_TIMEOUT_MS,
    );
    img.onload = () =>
      finish(() => {
        if (img.naturalWidth > 0 && img.naturalHeight > 0) resolve(img);
        else reject(new PrepareImageError("decode", "Imagen vacía"));
      });
    img.onerror = () =>
      finish(() => reject(new PrepareImageError("decode", "No se pudo decodificar")));
    img.src = url;
  });
}

/**
 * Decodifica el archivo con el camino que menos memoria consume que soporte
 * el navegador:
 *   1. `createImageBitmap(file)` — sin base64 y, en iOS, con los códecs del
 *      sistema (abre HEIC); `imageOrientation` aplica la rotación del EXIF,
 *      así la foto no sale de lado.
 *   2. el mismo con `resizeWidth`, para que sea el navegador quien reduzca
 *      mientras decodifica (si el paso 1 se quedó sin memoria).
 *   3. `<img>` + `blob:` URL, para navegadores sin `createImageBitmap`.
 */
async function decodeImageFile(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    const attempts: (ImageBitmapOptions | undefined)[] = [
      { imageOrientation: "from-image" },
      { imageOrientation: "from-image", resizeWidth: MAX_WORKING_SIDE, resizeQuality: "high" },
    ];
    for (const options of attempts) {
      try {
        const bitmap = await createImageBitmap(file, options);
        if (bitmap.width > 0 && bitmap.height > 0) {
          return {
            source: bitmap,
            width: bitmap.width,
            height: bitmap.height,
            release: once(() => bitmap.close()),
          };
        }
        bitmap.close();
      } catch {
        /* HEIC en Chrome/Android, opciones no soportadas o falta de memoria:
         * se prueba el siguiente camino. */
      }
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await loadImageElement(url);
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      release: once(() => URL.revokeObjectURL(url)),
    };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err instanceof PrepareImageError
      ? err
      : new PrepareImageError("decode", "No se pudo decodificar");
  }
}

/** Tamaño de la imagen de trabajo (nunca amplía). */
export function workingSize(
  width: number,
  height: number,
): { width: number; height: number } {
  const scale = Math.min(
    1,
    MAX_WORKING_SIDE / Math.max(width, height),
    Math.sqrt(MAX_WORKING_PIXELS / (width * height)),
  );
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function newCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** iOS no libera la memoria del lienzo al perder la referencia; ponerlo a 0
 * sí la devuelve. */
function releaseCanvas(canvas: HTMLCanvasElement) {
  canvas.width = 0;
  canvas.height = 0;
}

function drawStep(
  source: CanvasImageSource,
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = newCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new PrepareImageError("canvas", "Canvas 2D no disponible");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

/**
 * Reduce a la mitad por pasos hasta acercarse al destino. Reducir >2× de una
 * sola pasada muestrea el original y se come el detalle fino (la letra
 * pequeña del documento y los módulos del PDF417); a mitades sucesivas el
 * resultado conserva mucho mejor esos bordes.
 */
function downscale(
  decoded: DecodedImage,
  target: { width: number; height: number },
): HTMLCanvasElement {
  let source = decoded.source;
  let width = decoded.width;
  let height = decoded.height;
  let intermediate: HTMLCanvasElement | null = null;

  while (width > target.width * 2 && height > target.height * 2) {
    let nextWidth = Math.max(target.width, Math.round(width / 2));
    let nextHeight = Math.max(target.height, Math.round(height / 2));
    // Un lienzo intermedio tampoco puede pasarse del tope de Safari.
    const overflow = Math.sqrt(MAX_CANVAS_PIXELS / (nextWidth * nextHeight));
    if (overflow < 1) {
      nextWidth = Math.max(target.width, Math.round(nextWidth * overflow));
      nextHeight = Math.max(target.height, Math.round(nextHeight * overflow));
    }
    const step = drawStep(source, nextWidth, nextHeight);
    if (intermediate) releaseCanvas(intermediate);
    intermediate = step;
    source = step;
    width = nextWidth;
    height = nextHeight;
  }

  const canvas = drawStep(source, target.width, target.height);
  if (intermediate) releaseCanvas(intermediate);
  return canvas;
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob !== "function") {
      reject(new PrepareImageError("canvas", "toBlob no disponible"));
      return;
    }
    canvas.toBlob(
      (blob) => {
        if (blob && blob.size > 0) resolve(blob);
        else reject(new PrepareImageError("canvas", "El navegador no pudo codificar la imagen"));
      },
      "image/jpeg",
      quality,
    );
  });
}

/**
 * Archivo elegido → imagen de trabajo (`blob:` URL) lista para el editor.
 * Lanza `PrepareImageError` con un código que el llamador traduce a un
 * mensaje accionable para el vendedor.
 */
export async function prepareImageFile(file: File): Promise<PreparedImage> {
  if (!looksLikeImage(file)) {
    throw new PrepareImageError("not_image", "El archivo no es una imagen");
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new PrepareImageError("too_large", `La imagen supera ${MAX_FILE_MB} MB`);
  }

  const decoded = await decodeImageFile(file);
  let canvas: HTMLCanvasElement | null = null;
  try {
    const target = workingSize(decoded.width, decoded.height);
    canvas = downscale(decoded, target);
    // El original ya está dibujado: liberar su memoria antes de codificar.
    decoded.release();
    const blob = await canvasToJpeg(canvas, WORKING_QUALITY);
    return {
      url: URL.createObjectURL(blob),
      width: target.width,
      height: target.height,
      sourceWidth: decoded.width,
      sourceHeight: decoded.height,
      bytes: blob.size,
    };
  } catch (err) {
    throw err instanceof PrepareImageError
      ? err
      : new PrepareImageError("canvas", "No se pudo procesar la imagen");
  } finally {
    decoded.release();
    if (canvas) releaseCanvas(canvas);
  }
}

/** Mensaje para el vendedor, según por qué falló. */
export function prepareImageErrorMessage(err: unknown): string {
  const code = err instanceof PrepareImageError ? err.code : "decode";
  switch (code) {
    case "not_image":
      return "Selecciona un archivo de imagen (JPG, PNG o HEIC).";
    case "too_large":
      return `La imagen supera ${MAX_FILE_MB} MB. Elige otra foto o tómala con la cámara.`;
    case "canvas":
      return "El navegador no pudo procesar esta foto. Cierra otras pestañas e inténtalo de nuevo, o tómala con la cámara.";
    default:
      return "No pudimos abrir esta foto. Si está en iCloud, ábrela primero en Fotos para que se descargue en el teléfono y vuelve a intentarlo; también puedes tomarla con la cámara.";
  }
}
