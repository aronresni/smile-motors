/**
 * Heurísticas locales para extraer campos del TEXTO OCR de una licencia /
 * ID de EE. UU. (imagen frontal principalmente).
 *
 * Es un RESPALDO: el camino fiable es PDF417 + AAMVA. Aquí se es conservador
 * y se devuelven solo campos con un patrón razonablemente específico.
 */
import type { ExtractedDocumentData } from "@/lib/sales/types";
import { normalizeLooseDate } from "@/lib/sales/extraction/date-normalize";
import { titleCase, squish } from "@/lib/sales/extraction/text-utils";
import { US_STATES } from "@/lib/sales/us-states";

const STATE_CODES = new Set(US_STATES.map((s) => s.code));
const STATE_NAMES = new Set(US_STATES.map((s) => s.name.toUpperCase()));

export interface OcrFieldParse {
  data: ExtractedDocumentData;
  fieldConfidence: Partial<Record<keyof ExtractedDocumentData, number>>;
}

export function parseUsLicenseText(
  text: string,
  baseConfidence: number,
): OcrFieldParse {
  const data: ExtractedDocumentData = {};
  const fieldConfidence: OcrFieldParse["fieldConfidence"] = {};
  const raw = text.replace(/\r/g, "");
  const upper = raw.toUpperCase();
  const lines = raw
    .split("\n")
    .map((l) => squish(l))
    .filter(Boolean);

  const dobMatch =
    /\b(?:DOB|DATE OF BIRTH|NACIMIENTO)\b[^\d]{0,12}(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4}|\d{4}[/.\-]\d{1,2}[/.\-]\d{1,2})/i.exec(
      raw,
    );
  if (dobMatch) {
    const iso = normalizeLooseDate(dobMatch[1]);
    if (iso && yearsFromNow(iso) <= -14 && yearsFromNow(iso) >= -110) {
      data.dateOfBirth = iso;
      fieldConfidence.dateOfBirth = baseConfidence * 0.9;
    }
  }

  const expMatch =
    /\b(?:EXP|EXPIRES|EXPIRATION)\b\.?[^\d]{0,12}(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4})/i.exec(
      raw,
    );
  if (expMatch) {
    const iso = normalizeLooseDate(expMatch[1]);
    // Una licencia vence a lo sumo ~15 años después; "2081" es un "2031" mal leído.
    if (iso && yearsFromNow(iso) <= 15 && yearsFromNow(iso) >= -15) {
      data.expirationDate = iso;
      fieldConfidence.expirationDate = baseConfidence * 0.85;
    }
  }

  const dlMatch =
    /\b(?:DL|LN|DLN|LIC(?:ENSE)?|ID|4D)\b[^A-Z0-9]{0,6}([A-Z]{0,2}\d[A-Z0-9]{4,17})\b/i.exec(
      upper,
    );
  if (dlMatch) {
    data.documentNumber = dlMatch[1].toUpperCase();
    fieldConfidence.documentNumber = baseConfidence * 0.7;
  } else {
    // Formato con guiones, sin depender de la etiqueta (que el OCR suele
    // leer mal): letra + grupos de dígitos, p. ej. Florida "A123-456-78-901-2".
    // Se guarda sin guiones, igual que lo trae el PDF417 (DAQ).
    const grouped = /([A-Z])[\s-]?(\d{3,4}(?:-\d{1,4}){2,4})(?![\d-])/.exec(upper);
    const digits = grouped ? grouped[2].replace(/-/g, "") : "";
    if (grouped && digits.length >= 8 && digits.length <= 14) {
      data.documentNumber = `${grouped[1]}${digits}`;
      fieldConfidence.documentNumber = baseConfidence * 0.7;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const m = /^(.*?)[,\s]+([A-Z]{2})\s+(\d{5})(?:-\d{4})?$/.exec(
      lines[i].toUpperCase(),
    );
    if (!m || !STATE_CODES.has(m[2])) continue;

    if (m[1].trim().length >= 2) {
      data.city = titleCase(m[1].trim());
      fieldConfidence.city = baseConfidence * 0.7;
    }
    data.state = m[2];
    fieldConfidence.state = baseConfidence * 0.8;
    data.postalCode = m[3];
    fieldConfidence.postalCode = baseConfidence * 0.85;

    const prev = i > 0 ? lines[i - 1] : "";
    if (
      /\d/.test(prev) &&
      prev.length >= 4 &&
      !/DOB|EXP|CLASS|SEX|HGT|WGT|EYES|HAIR|REST|END/i.test(prev)
    ) {
      data.addressLine1 = titleCase(prev);
      fieldConfidence.addressLine1 = baseConfidence * 0.6;
    }
    break;
  }

  // Nombres por OCR — 3 estrategias, en orden de confianza decreciente. Una
  // licencia real rara vez imprime literalmente "LN:"/"FN:"; el layout AAMVA
  // estándar (no exclusivo de ningún estado) numera los campos del frente
  // (1 = apellido, 2 = nombre(s), 3 = fecha de nacimiento, 4a/4b/4d =
  // emisión/vencimiento/licencia, 8 = dirección, 9 = clase).
  const lnMatch =
    /\b(?:LN|LAST NAME|FAMILY NAME|APELLIDOS?)\b\s*[:\-]?\s*([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ'\- ]{1,30})/.exec(
      upper,
    );
  const fnMatch =
    /\b(?:FN|FIRST NAME|GIVEN NAMES?|NOMBRES?)\b\s*[:\-]?\s*([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ'\- ]{1,30})/.exec(
      upper,
    );
  if (lnMatch) {
    data.lastName = titleCase(lnMatch[1].trim());
    fieldConfidence.lastName = baseConfidence * 0.5;
  }
  if (fnMatch) {
    data.firstName = titleCase(fnMatch[1].trim());
    fieldConfidence.firstName = baseConfidence * 0.5;
  }

  // Estrategia 2: campos numerados "1 <APELLIDO>" / "2 <NOMBRE(S)>" —
  // convención AAMVA del frente, en cualquier línea (a veces el número y el
  // valor quedan en la misma línea de OCR, a veces el número solo).
  if (!data.lastName) {
    const numbered = findNumberedNameLine(lines, ["1"]);
    if (numbered) {
      data.lastName = titleCase(numbered);
      fieldConfidence.lastName = baseConfidence * 0.55;
    }
  }
  if (!data.firstName) {
    const numbered = findNumberedNameLine(lines, ["2"]);
    if (numbered) {
      data.firstName = titleCase(numbered);
      fieldConfidence.firstName = baseConfidence * 0.55;
    }
  }

  // Estrategia 3 (último recurso, confianza baja): dos líneas cortas
  // consecutivas de solo letras, tras descartar encabezados/etiquetas
  // conocidas — el orden impreso habitual es apellido(s) y luego nombre(s).
  // Solo con un OCR razonablemente limpio: con una foto difícil (holograma,
  // reflejo) adivinaba basura como "Florida Orverucense" — mejor dejar el
  // campo vacío que autocompletar un nombre falso.
  if (!data.lastName && !data.firstName && baseConfidence >= MIN_GUESS_CONFIDENCE) {
    const guess = guessNameFromPlainLines(lines);
    if (guess) {
      data.lastName = titleCase(guess.lastName);
      fieldConfidence.lastName = baseConfidence * 0.3;
      data.firstName = titleCase(guess.firstName);
      fieldConfidence.firstName = baseConfidence * 0.3;
    }
  }

  return { data, fieldConfidence };
}

/** Confianza OCR mínima para el último recurso (adivinar el nombre por
 * líneas sueltas). */
const MIN_GUESS_CONFIDENCE = 0.6;

/** Años (con signo) entre hoy y una fecha ISO; negativo = en el pasado. */
function yearsFromNow(iso: string): number {
  return (Date.parse(iso) - Date.now()) / (365.25 * 24 * 3600 * 1000);
}

/** Palabras que nunca son parte de un nombre — encabezados/etiquetas del
 * frente de una licencia de EE. UU. (genérico, no específico de un estado). */
const NON_NAME_WORDS =
  /^(USA|UNITED|STATES|DRIVER|DRIVERS|LICENSE|LICENCE|IDENTIFICATION|ID|CARD|CLASS|SEX|HGT|WGT|EYES|HAIR|DONOR|VETERAN|END|RESTRICTIONS?|REST|ISS|EXP|DOB|DL|LN|FN|DD)$/;

/** Fragmentos de etiquetas que delatan una lectura corrupta aunque el OCR
 * les pegue letras ("SCLASSE", "ORVERLICENSE"). */
const LABEL_FRAGMENTS = /(DRIVER|LICEN[CS]E|CLASS|DONOR|VETERAN|RESTRICT|ENDORSE|IDENTIFICATION)/;

/** Nombre de algún estado como palabra completa dentro de la línea. */
const STATE_NAME_IN_LINE = new RegExp(
  `\\b(${[...STATE_NAMES].map((n) => n.replace(/\s+/g, "\\s+")).join("|")})\\b`,
);

/**
 * Busca una línea de la forma "<número><separador opcional><VALOR>" (p. ej.
 * "1 SMITH", "1. SMITH", "1SMITH") para alguno de los prefijos dados, o —si
 * el número quedó en su propia línea (falla común de OCR con fuente
 * pequeña)— el valor en la línea SIGUIENTE.
 */
function findNumberedNameLine(lines: string[], prefixes: string[]): string | null {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    for (const p of prefixes) {
      const sameLine = new RegExp(`^${p}[.)\\s]+([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ'\\- ]{1,30})$`, "i").exec(line);
      if (sameLine && isPlausibleNameToken(sameLine[1])) return sameLine[1].trim();
      if (new RegExp(`^${p}$`).test(line) && i + 1 < lines.length) {
        const next = lines[i + 1].trim();
        if (isPlausibleNameToken(next)) return next;
      }
    }
  }
  return null;
}

function isPlausibleNameToken(token: string): boolean {
  const t = token.trim();
  if (t.length < 2 || t.length > 30) return false;
  if (!/^[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ'\- ]*$/i.test(t)) return false;
  const upperT = t.toUpperCase();
  // Las licencias imprimen los nombres en MAYÚSCULAS: minúsculas en la
  // lectura ("scLassE", "Florida orverucene") indican OCR corrupto.
  if (t !== upperT) return false;
  if (STATE_NAMES.has(upperT)) return false;
  if (LABEL_FRAGMENTS.test(upperT)) return false;
  // Ninguna palabra de la línea puede ser un encabezado/etiqueta conocido —
  // así se descarta también "DRIVER'S LICENSE" (dos palabras, con o sin
  // apóstrofo), no solo cada una por separado.
  if (
    upperT
      .split(/\s+/)
      .some((w) => NON_NAME_WORDS.test(w.replace(/[^A-ZÁÉÍÓÚÑ]/g, "")))
  ) {
    return false;
  }
  return true;
}

/**
 * Último recurso: dos líneas cortas consecutivas de solo letras (sin
 * dígitos, sin etiquetas conocidas) cerca del inicio del documento. Confianza
 * baja a propósito — el orden se asume apellido(s) primero, luego nombre(s),
 * que es el orden de impresión más común, pero puede fallar.
 */
function guessNameFromPlainLines(
  lines: string[],
): { lastName: string; firstName: string } | null {
  const candidates = lines
    .slice(0, 12) // el bloque de nombre suele estar cerca del encabezado
    .filter(
      (l) => isPlausibleNameToken(l) && !/\d/.test(l) && !STATE_NAME_IN_LINE.test(l.toUpperCase()),
    );
  for (let i = 0; i < candidates.length - 1; i++) {
    return { lastName: candidates[i], firstName: candidates[i + 1] };
  }
  return null;
}
