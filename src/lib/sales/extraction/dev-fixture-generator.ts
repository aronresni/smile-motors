/**
 * Generador de fixtures SINTÉTICAS (solo `/dev/ocr-fixtures`, nunca se
 * importa desde el flujo real de venta). Sirve para probar el pipeline REAL
 * de extremo a extremo (WASM/Canvas/Tesseract reales, en el navegador) sin
 * depender de fotos reales de documentos — útil tanto para desarrollo manual
 * como para la prueba automatizada (`e2e/`). Los valores codificados son
 * INVENTADOS a propósito (no corresponden a ninguna persona real).
 */

const SYNTHETIC_AAMVA_PAYLOAD = [
  "@",
  "ANSI 636054090002DL00410278ZN02290032DL",
  "DAQZ99887766",
  "DCSMORALES",
  "DACPATRICIA",
  "DADANN",
  "DBB03121985",
  "DBA08272031",
  "DAG742 ELM ST",
  "DAICOLUMBUS",
  "DAJNE",
  "DAK68601-1234",
].join("\n");

/** Campos que debería devolver el parser AAMVA para el payload de arriba —
 * usado por la prueba E2E para verificar que el decodificador REAL (no un
 * valor fijo) produjo estos datos. */
export const SYNTHETIC_AAMVA_EXPECTED = {
  firstName: "Patricia Ann",
  lastName: "Morales",
  documentNumber: "Z99887766",
  dateOfBirth: "1985-03-12",
  expirationDate: "2031-08-27",
  addressLine1: "742 Elm St",
  city: "Columbus",
  state: "NE",
  postalCode: "68601",
};

/** Genera un PDF417 real (ZXing-C++/WASM, motor "writer") con el payload
 * AAMVA sintético de arriba, COMPUESTO sobre un lienzo con forma de tarjeta
 * (relación ~1.59:1, como una licencia real) con margen alrededor — así el
 * recorte 16:10 del editor de imágenes (pensado para fotografiar la tarjeta
 * COMPLETA, no solo el código) no le corta ningún borde al símbolo. Un
 * recorte ajustado SOLO al código, sin margen, sí puede perder columnas del
 * PDF417 — que es justamente lo que simula una foto real de toda la tarjeta.
 */
export async function generateSyntheticUsBackImage(): Promise<string> {
  const { prepareZXingModule, writeBarcode } = await import("zxing-wasm/writer");
  prepareZXingModule({ overrides: { locateFile: (path: string) => `/zxing/${path}` } });
  const { image } = await writeBarcode(SYNTHETIC_AAMVA_PAYLOAD, {
    format: "PDF417",
    scale: 3,
  });
  if (!image) throw new Error("No se pudo generar el PDF417 sintético");
  const barcodeUrl = await blobToDataUrl(image);
  return compositeOnCard(barcodeUrl);
}

/** Dibuja una imagen (p. ej. el PDF417 generado) centrada, con margen, sobre
 * un lienzo blanco con la proporción típica de una tarjeta de identidad. */
async function compositeOnCard(imageDataUrl: string): Promise<string> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("image_load_failed"));
    img.src = imageDataUrl;
  });

  const cardW = 1013; // ~ CR80 a 300dpi
  const cardH = 638;
  const canvas = document.createElement("canvas");
  canvas.width = cardW;
  canvas.height = cardH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_unavailable");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, cardW, cardH);

  const margin = 60;
  const maxW = cardW - margin * 2;
  const maxH = cardH - margin * 2;
  const scale = Math.min(maxW / img.width, maxH / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, (cardW - w) / 2, (cardH - h) / 2, w, h);
  return canvas.toDataURL("image/png");
}

function drawLines(lines: string[], opts: { width?: number; height?: number } = {}): string {
  const canvas = document.createElement("canvas");
  canvas.width = opts.width ?? 900;
  canvas.height = opts.height ?? 560;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_unavailable");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000000";
  ctx.font = "28px monospace";
  ctx.textBaseline = "top";
  let y = 24;
  for (const line of lines) {
    ctx.fillText(line, 24, y);
    y += 40;
  }
  return canvas.toDataURL("image/png");
}

/** Imagen "frente" sintética (texto renderizado, no una foto real) para
 * probar el fallback de OCR cuando el PDF417 no está disponible/falla. */
export function generateSyntheticUsFrontImage(): string {
  return drawLines([
    "NEBRASKA",
    "DRIVER LICENSE",
    "1 MORALES",
    "2 PATRICIA ANN",
    "3 DOB 03/12/1985",
    "4B EXP 08/27/2031",
    "4D DL Z9988776",
    "742 ELM ST",
    "COLUMBUS NE 68601",
  ]);
}

const SYNTHETIC_CUBAN_MRZ_LINES = [
  "I<CUBAFX112233699010512345<<<<",
  "650320F301115<<<<<<<<<<<<<<<<<",
  "PEREZ<SUAREZ<<YANELIS<<<<<<<<<",
];

export const SYNTHETIC_CUBAN_EXPECTED = {
  identityNumber: "99010512345",
  fullName: "Yanelis Perez Suarez",
};

/** Imagen "reverso" sintética del carné cubano (zona MRZ-like renderizada). */
export function generateSyntheticCubanBackImage(): string {
  return drawLines(SYNTHETIC_CUBAN_MRZ_LINES, { width: 900, height: 260 });
}

/** Imagen "frente" sintética del carné cubano (etiquetas + valores). */
export function generateSyntheticCubanFrontImage(): string {
  return drawLines([
    "REPUBLICA DE CUBA",
    "CARNE DE IDENTIDAD",
    "NI: 99010512345",
    "NOMBRE / FIRST NAME",
    "YANELIS",
    "APELLIDOS / LAST NAME",
    "PEREZ SUAREZ",
    "SEXO F",
    "FECHA DE VENCIMIENTO 15/11/2030",
  ]);
}

/**
 * Payload con el formato COMPLETO de una licencia real (inventado): separador
 * de registro (RS) y retorno de carro en la cabecera, el primer elemento
 * (DAQ) PEGADO a la cabecera, segundo nombre "NONE" y ~30 elementos, como el
 * de Florida. Cubre las tres trampas que dejaban el formulario vacío con una
 * licencia real: modo de texto del lector, DAQ en la cabecera y "NONE".
 */
const SYNTHETIC_AAMVA_FULL_PAYLOAD =
  "@\n\x1e\rANSI 636010090002DL00410330ZF03710047DLDAQR512448907710\n" +
  [
    "DCSQUINTANA BERMUDEZ",
    "DDEN",
    "DACROLANDO",
    "DDFN",
    "DADNONE",
    "DDGN",
    "DCAE",
    "DCBNONE",
    "DCDNONE",
    "DBD04152024",
    "DBB07091971",
    "DBA07092032",
    "DBC1",
    "DAU070 IN",
    "DAG2280 SUNSET PALM WAY",
    "DAIKISSIMMEE",
    "DAJFL",
    "DAK347461234  ",
    "DCFR512448907710415",
    "DCGUSA",
    "DCK0000123456789012",
    "DDAF",
    "DDB03012020",
    "DDK1",
  ].join("\n") +
  "\r" +
  ["ZFZFA", "ZFB", "ZFCSAFE DRIVER", "ZFD", "ZFE", "ZFF", "ZFG", "ZFH", "ZFI", "ZFJ1234567890", "ZFK"].join(
    "\n",
  ) +
  "\r";

export const SYNTHETIC_AAMVA_FULL_EXPECTED = {
  firstName: "Rolando",
  lastName: "Quintana Bermudez",
  documentNumber: "R512448907710",
  dateOfBirth: "1971-07-09",
  expirationDate: "2032-07-09",
  addressLine1: "2280 Sunset Palm Way",
  city: "Kissimmee",
  state: "FL",
  postalCode: "34746",
};

/**
 * Reverso SINTÉTICO como llega una foto COMPRIMIDA de la galería (p. ej.
 * reenviada por WhatsApp): el PDF417 queda a ~1,3 px por módulo, la tarjeta
 * ocupa una parte de una foto vertical con fondo de color y todo se
 * recomprime en JPEG. Sin ampliar la región, ningún decodificador lo lee.
 */
export async function generateSyntheticUsBackLowResImage(): Promise<string> {
  const { prepareZXingModule, writeBarcode } = await import("zxing-wasm/writer");
  prepareZXingModule({ overrides: { locateFile: (path: string) => `/zxing/${path}` } });
  const { image } = await writeBarcode(SYNTHETIC_AAMVA_FULL_PAYLOAD, {
    format: "PDF417",
    scale: 1,
  });
  if (!image) throw new Error("No se pudo generar el PDF417 sintético");
  const barcode = new Image();
  await new Promise<void>((resolve, reject) => {
    barcode.onload = () => resolve();
    barcode.onerror = () => reject(new Error("image_load_failed"));
    barcode.src = URL.createObjectURL(image);
  });

  const photo = document.createElement("canvas");
  photo.width = 900;
  photo.height = 1600;
  const ctx = photo.getContext("2d");
  if (!ctx) throw new Error("canvas_unavailable");
  ctx.fillStyle = "#5b2a86"; // fondo (mesa / tela)
  ctx.fillRect(0, 0, photo.width, photo.height);
  const card = { x: 10, y: 170, w: 790, h: 500 };
  ctx.fillStyle = "#f4f4f1";
  ctx.fillRect(card.x, card.y, card.w, card.h);
  ctx.fillStyle = "#222";
  ctx.font = "16px sans-serif";
  ctx.fillText("CLASS: E - Any non-commercial vehicle", card.x + 200, card.y + 280);
  ctx.fillText("REST: None      END: None", card.x + 200, card.y + 320);
  const moduleScale = 1.3;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    barcode,
    card.x + 150,
    card.y + 25,
    barcode.width * moduleScale,
    barcode.height * moduleScale,
  );
  URL.revokeObjectURL(barcode.src);
  return photo.toDataURL("image/jpeg", 0.72);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("blob_read_failed"));
    reader.readAsDataURL(blob);
  });
}
