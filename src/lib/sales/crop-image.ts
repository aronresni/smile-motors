/**
 * Recorte + rotación de imágenes en canvas (receta canónica de react-easy-crop).
 * Solo cliente. Devuelve un data URL JPEG.
 */
export interface PixelCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

const toRadian = (deg: number) => (deg * Math.PI) / 180;

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
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D no disponible");

  const rad = toRadian(rotationDeg);
  const box = rotatedBoundingBox(image.width, image.height, rotationDeg);

  canvas.width = box.width;
  canvas.height = box.height;

  ctx.translate(box.width / 2, box.height / 2);
  ctx.rotate(rad);
  ctx.translate(-image.width / 2, -image.height / 2);
  ctx.drawImage(image, 0, 0);

  const imageData = ctx.getImageData(
    Math.max(0, Math.round(crop.x)),
    Math.max(0, Math.round(crop.y)),
    Math.max(1, Math.round(crop.width)),
    Math.max(1, Math.round(crop.height)),
  );

  canvas.width = Math.max(1, Math.round(crop.width));
  canvas.height = Math.max(1, Math.round(crop.height));
  ctx.putImageData(imageData, 0, 0);

  // 0.95: la recompresión JPEG del recorte alimenta directamente PDF417/OCR
  // — con las 4 fotos reales de la tarea, 0.9 perdía fidelidad suficiente
  // para degradar el resultado en casos límite (letra pequeña, MRZ).
  return canvas.toDataURL("image/jpeg", 0.95);
}
