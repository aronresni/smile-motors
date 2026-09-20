/**
 * Recorte + rotación de imágenes en canvas. Solo cliente. Devuelve un data
 * URL JPEG.
 *
 * Dibuja ÚNICAMENTE la zona recortada: el lienzo mide lo que mide el recorte,
 * no la foto entera. La versión anterior pintaba la imagen completa (hasta
 * 16 MP = 64 MB), sacaba un `getImageData` del recorte (otra copia completa)
 * y lo devolvía con `putImageData`; en un iPhone eso son tres reservas
 * grandes seguidas y Safari falla en silencio. Con la transformación aplicada
 * al contexto el resultado es idéntico pixel a pixel, con una sola reserva
 * del tamaño del recorte.
 */
export interface PixelCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

const toRadian = (deg: number) => (deg * Math.PI) / 180;

/** Tope de píxeles del resultado. Safari/iOS no dibuja lienzos de más de
 * ~16,7 MP (falla en silencio). La imagen de trabajo ya llega reducida
 * (`prepare-image-file.ts`), así que este tope solo actúa sobre orígenes
 * antiguos — p. ej. "Reajustar" sobre una foto ya subida a tamaño completo. */
const MAX_OUTPUT_PIXELS = 12_000_000;

function rotatedBoundingBox(width: number, height: number, rotationDeg: number) {
  const rad = toRadian(rotationDeg);
  return {
    width: Math.abs(Math.cos(rad) * width) + Math.abs(Math.sin(rad) * height),
    height: Math.abs(Math.sin(rad) * width) + Math.abs(Math.cos(rad) * height),
  };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.addEventListener("load", () => resolve(img));
    img.addEventListener("error", () =>
      reject(new Error("No se pudo cargar la imagen")),
    );
    // Origen remoto (URL firmada de Supabase al reajustar un borrador ya
    // guardado): sin CORS el lienzo queda contaminado y `toDataURL` lanza.
    if (/^https?:/i.test(src)) img.crossOrigin = "anonymous";
    img.src = src;
  });
}

export async function getCroppedImage(
  src: string,
  crop: PixelCrop,
  rotationDeg = 0,
): Promise<string> {
  const image = await loadImage(src);
  const canvas = document.createElement("canvas");

  const rad = toRadian(rotationDeg);
  const box = rotatedBoundingBox(image.width, image.height, rotationDeg);
  const cropWidth = Math.max(1, crop.width);
  const cropHeight = Math.max(1, crop.height);
  // El recorte llega en píxeles de la imagen rotada a tamaño completo; si el
  // resultado se pasa del tope, se escala todo por igual.
  const scale = Math.min(1, Math.sqrt(MAX_OUTPUT_PIXELS / (cropWidth * cropHeight)));

  canvas.width = Math.max(1, Math.round(cropWidth * scale));
  canvas.height = Math.max(1, Math.round(cropHeight * scale));

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D no disponible");

  // Lo que quede fuera de la foto (recorte desplazado o esquinas vacías de
  // una rotación libre) sale blanco, no negro: no estorba al OCR.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.imageSmoothingQuality = "high";
  // Coordenadas finales = (píxeles de la imagen rotada − origen del recorte)
  // × escala. Las transformaciones se aplican en este orden.
  ctx.translate(-crop.x * scale, -crop.y * scale);
  ctx.scale(scale, scale);
  ctx.translate(box.width / 2, box.height / 2);
  ctx.rotate(rad);
  ctx.translate(-image.width / 2, -image.height / 2);
  ctx.drawImage(image, 0, 0);

  // 0.95: la recompresión JPEG del recorte alimenta directamente PDF417/OCR
  // — con las 4 fotos reales de la tarea, 0.9 perdía fidelidad suficiente
  // para degradar el resultado en casos límite (letra pequeña, MRZ).
  const dataUrl = canvas.toDataURL("image/jpeg", 0.95);
  // iOS no libera la memoria del lienzo al perder la referencia.
  canvas.width = 0;
  canvas.height = 0;
  return dataUrl;
}
