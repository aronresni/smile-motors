/**
 * Preprocesado de imágenes para lectura de documentos. Solo navegador.
 *
 * IMPORTANTE: nunca modifica la imagen ORIGINAL/recortada que guardó el
 * vendedor (`DocumentUploadState.dataUrl`, generada por el editor de recorte
 * a resolución completa). Este módulo solo produce copias temporales en
 * memoria para el decodificador PDF417 / OCR — la "imagen de extracción" es
 * siempre derivada de la imagen ya recortada por el vendedor, nunca de un
 * preview reducido.
 */

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

let cachedImage: { src: string; img: HTMLImageElement } | null = null;

function loadImage(src: string): Promise<HTMLImageElement> {
  if (cachedImage && cachedImage.src === src) {
    return Promise.resolve(cachedImage.img);
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.addEventListener("load", () => {
      cachedImage = { src, img };
      resolve(img);
    });
    img.addEventListener("error", () =>
      reject(new Error("image_load_failed")),
    );
    img.src = src;
  });
}

export async function getImageDimensions(
  dataUrl: string,
): Promise<{ width: number; height: number }> {
  const img = await loadImage(dataUrl);
  return { width: img.naturalWidth || img.width, height: img.naturalHeight || img.height };
}

function scaledSize(
  w: number,
  h: number,
  { maxDim, minDim }: { maxDim: number; minDim: number },
): { width: number; height: number } {
  let scale = 1;
  const longest = Math.max(w, h);
  const shortest = Math.min(w, h);
  if (longest > maxDim) scale = maxDim / longest;
  else if (shortest < minDim) scale = Math.min(minDim / shortest, 2.5);
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

export interface GrayscaleRaster {
  width: number;
  height: number;
  /** 1 byte de luminancia por píxel. */
  gray: Uint8ClampedArray;
}

function rasterFromCanvas(
  canvas: HTMLCanvasElement,
  contrast: number,
): GrayscaleRaster {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("canvas_unavailable");
  const { width, height } = canvas;
  const { data } = ctx.getImageData(0, 0, width, height);
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    let v = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (contrast !== 1) v = (v - 128) * contrast + 128;
    gray[p] = v;
  }
  return { width, height, gray };
}

/**
 * Rasteriza a escala de grises, ajustando resolución a un rango razonable
 * para decodificar códigos de barras. Opcionalmente rota 0/90/180/270 y/o
 * rasteriza solo un sub-rectángulo (en coordenadas de la imagen ORIGINAL) —
 * así el "pase de región" puede pedir una resolución alta enfocada solo en
 * el área del código, en vez de reducir la foto completa.
 */
export async function toGrayscaleRaster(
  dataUrl: string,
  opts: {
    maxDim?: number;
    minDim?: number;
    contrast?: number;
    rotation?: 0 | 90 | 180 | 270;
    sourceRect?: PixelRect;
  } = {},
): Promise<GrayscaleRaster> {
  const { maxDim = 2400, minDim = 1100, contrast = 1, rotation = 0, sourceRect } = opts;
  const image = await loadImage(dataUrl);

  const srcW = sourceRect ? sourceRect.width : image.naturalWidth || image.width;
  const srcH = sourceRect ? sourceRect.height : image.naturalHeight || image.height;
  // El tamaño destino se calcula sobre el rectángulo fuente (recortado o no),
  // así una región pequeña puede pedirse a alta resolución relativa.
  const preRotation = rotation === 90 || rotation === 270
    ? scaledSize(srcH, srcW, { maxDim, minDim })
    : scaledSize(srcW, srcH, { maxDim, minDim });

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("canvas_unavailable");

  if (rotation === 0) {
    canvas.width = preRotation.width;
    canvas.height = preRotation.height;
    if (sourceRect) {
      ctx.drawImage(
        image,
        sourceRect.x, sourceRect.y, sourceRect.width, sourceRect.height,
        0, 0, canvas.width, canvas.height,
      );
    } else {
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    }
  } else {
    // Para 90/270 el destino rotado invierte ancho/alto.
    const destW = rotation === 90 || rotation === 270 ? preRotation.height : preRotation.width;
    const destH = rotation === 90 || rotation === 270 ? preRotation.width : preRotation.height;
    canvas.width = destW;
    canvas.height = destH;
    ctx.translate(destW / 2, destH / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.translate(-preRotation.width / 2, -preRotation.height / 2);
    if (sourceRect) {
      ctx.drawImage(
        image,
        sourceRect.x, sourceRect.y, sourceRect.width, sourceRect.height,
        0, 0, preRotation.width, preRotation.height,
      );
    } else {
      ctx.drawImage(image, 0, 0, preRotation.width, preRotation.height);
    }
  }

  return rasterFromCanvas(canvas, contrast);
}

/**
 * Umbral adaptativo simple (media local por bloque). Convierte a blanco/negro
 * puro — útil como pase adicional cuando el contraste global es pobre
 * (sombra de la foto de teléfono, reflejo, etc.).
 */
export function binarizeAdaptive(
  raster: GrayscaleRaster,
  blockSize = 24,
): GrayscaleRaster {
  const { width, height, gray } = raster;
  const out = new Uint8ClampedArray(width * height);
  for (let by = 0; by < height; by += blockSize) {
    const bh = Math.min(blockSize, height - by);
    for (let bx = 0; bx < width; bx += blockSize) {
      const bw = Math.min(blockSize, width - bx);
      let sum = 0;
      for (let y = by; y < by + bh; y++) {
        for (let x = bx; x < bx + bw; x++) sum += gray[y * width + x];
      }
      const mean = sum / (bw * bh);
      const threshold = mean - 8; // ligero sesgo hacia negro conserva barras finas
      for (let y = by; y < by + bh; y++) {
        for (let x = bx; x < bx + bw; x++) {
          const idx = y * width + x;
          out[idx] = gray[idx] < threshold ? 0 : 255;
        }
      }
    }
  }
  return { width, height, gray: out };
}

/**
 * Puntuación de "regularidad vertical" de una banda de filas: mide cuán
 * CONSISTENTE es la posición de los bordes verticales entre filas contiguas.
 * Las barras de un PDF417 son verticales y se repiten en la misma posición
 * de columna a lo largo de decenas de filas (cada "fila" del símbolo mide
 * varios píxeles de alto); un párrafo de texto denso tiene bordes que se
 * desplazan de fila a fila (trazos de letras, ascendentes/descendentes,
 * espacios entre palabras). Esto es lo que distingue un código de barras de
 * texto denso — ambos pueden tener densidad de bordes similar, pero solo el
 * código tiene columnas "encendidas" de forma consistente.
 *
 * Devuelve, por columna, la fracción de filas de la banda en que esa columna
 * tuvo un borde — y de ahí una puntuación 0..1 de cuán BIMODAL es esa
 * distribución (columnas claramente "sí" o claramente "no", pocas a medias).
 */
function bandRegularityScore(
  gray: Uint8ClampedArray,
  width: number,
  top: number,
  bottom: number,
): number {
  const rows = bottom - top;
  if (rows < 3 || width < 3) return 0;

  const colOnCount = new Float64Array(width);
  for (let y = top; y < bottom; y++) {
    const rowStart = y * width;
    // Umbral LOCAL por fila (no global) para que la puntuación no dependa
    // del contraste absoluto de la foto.
    let rowEdgeSum = 0;
    for (let x = 1; x < width; x++) {
      rowEdgeSum += Math.abs(gray[rowStart + x] - gray[rowStart + x - 1]);
    }
    const rowThreshold = (rowEdgeSum / width) * 1.3;
    for (let x = 1; x < width; x++) {
      if (Math.abs(gray[rowStart + x] - gray[rowStart + x - 1]) > rowThreshold) {
        colOnCount[x] += 1;
      }
    }
  }

  let bimodal = 0;
  for (let x = 1; x < width; x++) {
    const frac = colOnCount[x] / rows;
    if (frac < 0.15 || frac > 0.65) bimodal += 1;
  }
  return bimodal / width;
}

interface BandCandidate {
  top: number;
  bottom: number;
  edgeScore: number;
}

/**
 * Localiza heurísticamente la región de un código PDF417 dentro de una
 * imagen ya recortada al documento. Combina DOS señales — no solo densidad
 * de bordes verticales (que el texto impreso también produce, causando
 * falsos positivos sobre párrafos de restricciones en vez del código real):
 *
 *   1. Densidad de bordes por banda de filas (código de barras: muchas
 *      barras delgadas contiguas).
 *   2. Regularidad vertical de esa banda (ver `bandRegularityScore`) — el
 *      código mantiene las mismas columnas "encendidas" fila tras fila;
 *      texto denso no.
 *
 * Se evalúan TODAS las bandas candidatas por encima del umbral de densidad
 * (no solo la de mayor densidad) y se elige la de mejor puntuación
 * combinada. Devuelve el rectángulo en coordenadas de la imagen ORIGINAL,
 * listo para volver a rasterizar a resolución completa. `null` si no hay
 * ninguna banda suficientemente distintiva.
 */
export async function locateBarcodeRegion(
  dataUrl: string,
): Promise<PixelRect | null> {
  const dims = await getImageDimensions(dataUrl);
  if (!dims.width || !dims.height) return null;

  // Raster pequeño y barato SOLO para localizar la banda; el pase de
  // decodificación real vuelve a rasterizar la región a resolución completa.
  const preview = await toGrayscaleRaster(dataUrl, { maxDim: 900, minDim: 500 });
  const { width, height, gray } = preview;

  const rowScore = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    let edges = 0;
    const rowStart = y * width;
    for (let x = 1; x < width; x++) {
      edges += Math.abs(gray[rowStart + x] - gray[rowStart + x - 1]);
    }
    rowScore[y] = edges / width;
  }

  const sorted = Float64Array.from(rowScore).sort();
  const median = sorted[Math.floor(sorted.length / 2)] || 1;
  const threshold = median * 1.6;

  // TODAS las bandas contiguas de filas por encima del umbral (no solo la
  // de mayor densidad acumulada) — cada una es una candidata a evaluar.
  const candidates: BandCandidate[] = [];
  let curStart = -1;
  let curScore = 0;
  const minBandPx = Math.max(6, Math.round(height * 0.06));
  for (let y = 0; y <= height; y++) {
    const above = y < height && rowScore[y] > threshold;
    if (above) {
      if (curStart === -1) curStart = y;
      curScore += rowScore[y];
    } else if (curStart !== -1) {
      const bandHeight = y - curStart;
      if (bandHeight >= minBandPx) {
        candidates.push({ top: curStart, bottom: y, edgeScore: curScore });
      }
      curStart = -1;
      curScore = 0;
    }
  }
  if (candidates.length === 0) return null;

  const maxEdgeScore = Math.max(...candidates.map((c) => c.edgeScore));
  let best: BandCandidate | null = null;
  let bestCombined = 0;
  for (const c of candidates) {
    const regularity = bandRegularityScore(gray, width, c.top, c.bottom);
    // La densidad de bordes por sí sola favorecería texto denso; se pondera
    // fuerte por regularidad para preferir el código de barras real.
    const combined = (c.edgeScore / maxEdgeScore) * (0.25 + 0.75 * regularity);
    if (combined > bestCombined) {
      bestCombined = combined;
      best = c;
    }
  }
  if (!best) return null;
  const { top: bestStart, bottom: bestEnd } = best;

  // Recorte horizontal dentro de la banda: columnas con densidad de borde
  // apreciable (evita arrastrar márgenes en blanco a los lados).
  const colScore = new Float64Array(width);
  for (let x = 1; x < width; x++) {
    let edges = 0;
    for (let y = bestStart; y < bestEnd; y++) {
      const row = y * width;
      edges += Math.abs(gray[row + x] - gray[row + x - 1]);
    }
    colScore[x] = edges / Math.max(1, bestEnd - bestStart);
  }
  const colSorted = Float64Array.from(colScore).sort();
  const colMedian = colSorted[Math.floor(colSorted.length / 2)] || 1;
  const colThreshold = colMedian * 1.2;
  let left = 0;
  let right = width - 1;
  while (left < width && colScore[left] < colThreshold) left++;
  while (right > left && colScore[right] < colThreshold) right--;
  if (right - left < width * 0.25) {
    // Recorte horizontal poco confiable: conservar el ancho completo.
    left = 0;
    right = width - 1;
  }

  // Márgenes de seguridad + mapeo a coordenadas de la imagen original.
  const marginY = Math.round((bestEnd - bestStart) * 0.2);
  const marginX = Math.round((right - left) * 0.05);
  const top = Math.max(0, bestStart - marginY);
  const bottom = Math.min(height, bestEnd + marginY);
  const leftPx = Math.max(0, left - marginX);
  const rightPx = Math.min(width, right + marginX);

  const scaleX = dims.width / width;
  const scaleY = dims.height / height;
  const rect: PixelRect = {
    x: Math.round(leftPx * scaleX),
    y: Math.round(top * scaleY),
    width: Math.round((rightPx - leftPx) * scaleX),
    height: Math.round((bottom - top) * scaleY),
  };
  if (rect.width < 20 || rect.height < 10) return null;
  return rect;
}

/**
 * Región de la zona legible por máquina (MRZ-like) del reverso del carné
 * cubano: por convención de layout ocupa la franja inferior de la tarjeta.
 * No requiere detección de bordes — es una heurística relativa al recorte
 * ya hecho por el vendedor, como pide la tarea. `fraction` = proporción de
 * la altura total, medida desde abajo.
 */
export async function lowerBandRegion(
  dataUrl: string,
  fraction: number,
): Promise<PixelRect> {
  const dims = await getImageDimensions(dataUrl);
  const height = Math.round(dims.height * fraction);
  return {
    x: 0,
    y: Math.max(0, dims.height - height),
    width: dims.width,
    height,
  };
}

/**
 * Enfoque (unsharp mask 3×3) in-place sobre RGBA. Tras ampliar una foto de
 * baja resolución, recupera el borde de las barras finas del PDF417 que la
 * interpolación suaviza.
 */
function sharpenRgba(imageData: ImageData, amount = 1): void {
  const { width, height, data } = imageData;
  const src = new Uint8ClampedArray(data);
  const center = 1 + 4 * amount;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = (y * width + x) * 4;
      const up = i - width * 4;
      const down = i + width * 4;
      for (let c = 0; c < 3; c++) {
        data[i + c] =
          center * src[i + c] -
          amount * (src[i - 4 + c] + src[i + 4 + c] + src[up + c] + src[down + c]);
      }
    }
  }
}

/**
 * Rasteriza a `ImageData` en COLOR (RGBA, sin conversión a escala de grises)
 * para el decodificador ZXing-C++/WASM — su propio binarizador interno hace
 * un mejor trabajo que preprocesar nosotros mismos, así que aquí solo se
 * ajusta resolución y (opcionalmente) se recorta a un sub-rectángulo.
 *
 * `upscale` > 1 AMPLÍA la fuente (sin pasar de `maxDim`): las fotos
 * comprimidas (p. ej. reenviadas por WhatsApp) dejan el PDF417 a ~1 px por
 * módulo, por debajo de lo que el decodificador resuelve; ampliado 2–3× con
 * interpolación de calidad (y `sharpen`) vuelve a ser legible.
 */
export async function toRgbaImageData(
  dataUrl: string,
  opts: { maxDim?: number; sourceRect?: PixelRect; upscale?: number; sharpen?: boolean } = {},
): Promise<ImageData> {
  const { maxDim = 2600, sourceRect, upscale = 1, sharpen = false } = opts;
  const image = await loadImage(dataUrl);
  const srcW = sourceRect ? sourceRect.width : image.naturalWidth || image.width;
  const srcH = sourceRect ? sourceRect.height : image.naturalHeight || image.height;
  const longest = Math.max(srcW, srcH);
  const scale = Math.min(upscale, maxDim / longest);
  const width = Math.max(1, Math.round(srcW * scale));
  const height = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("canvas_unavailable");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  if (sourceRect) {
    ctx.drawImage(
      image,
      sourceRect.x, sourceRect.y, sourceRect.width, sourceRect.height,
      0, 0, width, height,
    );
  } else {
    ctx.drawImage(image, 0, 0, width, height);
  }
  const imageData = ctx.getImageData(0, 0, width, height);
  if (sharpen) sharpenRgba(imageData);
  return imageData;
}

/**
 * Copia de trabajo para OCR: escala de grises + contraste, tamaño moderado.
 * Devuelve un data URL PNG. Puede limitarse a un sub-rectángulo.
 */
export async function toOcrDataUrl(
  dataUrl: string,
  opts: { maxWidth?: number; contrast?: number; sourceRect?: PixelRect } = {},
): Promise<string> {
  const { maxWidth = 1800, contrast = 1.4, sourceRect } = opts;
  const image = await loadImage(dataUrl);

  const srcW = sourceRect ? sourceRect.width : image.width;
  const srcH = sourceRect ? sourceRect.height : image.height;
  const scale = srcW > maxWidth ? maxWidth / srcW : 1;
  const width = Math.max(1, Math.round(srcW * scale));
  const height = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("canvas_unavailable");
  if (sourceRect) {
    ctx.drawImage(
      image,
      sourceRect.x, sourceRect.y, sourceRect.width, sourceRect.height,
      0, 0, width, height,
    );
  } else {
    ctx.drawImage(image, 0, 0, width, height);
  }

  const imageData = ctx.getImageData(0, 0, width, height);
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    let v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    v = (v - 128) * contrast + 128;
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}
