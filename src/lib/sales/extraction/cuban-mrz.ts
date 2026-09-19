/**
 * Zona legible por máquina (estilo MRZ) del REVERSO del carné de identidad
 * cubano: tres líneas grandes en la franja inferior de la tarjeta, con un
 * alfabeto restringido (A-Z, 0-9, `<`). Es la fuente estructurada de mayor
 * confianza para el carné cubano — el equivalente al PDF417 en la licencia
 * de EE. UU. Local, sin AAMVA (parser completamente independiente).
 *
 * Ejemplo real (con fines de prueba, NO se usa ningún valor fijo aquí):
 *   I<CUBAEW953867688110402942<<<<
 *   8811042M3212220CUBAEW953867<<1
 *   BLANCO<GRAVERAN<<RAIDEL<<<<<<<<
 *
 * El análisis es DELIBERADAMENTE tolerante a desorden/errores de OCR: en vez
 * de asumir columnas fijas por línea (el formato no es ICAO 9303 estricto),
 * busca patrones distintivos sobre el texto reconstruido completo:
 *   - un carné cubano siempre indica el número de identidad (NI) como una
 *     corrida de 11 dígitos consecutivos;
 *   - la fecha de nacimiento / vencimiento aparecen como `YYMMDD` [+ control] + sexo
 *     (M/F) + `YYMMDD`;
 *   - la línea de nombre usa el patrón `APELLIDO(S)<<NOMBRE(S)` con `<` como
 *     separador de palabra y `<<` como separador de bloque.
 */
import type { ExtractedRecipientData } from "@/lib/sales/types";
import { normalizeMrzYyMmDd } from "@/lib/sales/extraction/date-normalize";
import { titleCase } from "@/lib/sales/extraction/text-utils";
import {
  lowerBandRegion,
  toOcrDataUrl,
} from "@/lib/sales/extraction/image-preprocess";
import { recognizeText } from "@/lib/sales/extraction/ocr-worker";

export const MRZ_CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<";

export interface CubanMrzParse {
  data: ExtractedRecipientData;
  fieldConfidence: Partial<Record<keyof ExtractedRecipientData, number>>;
  /** Líneas reconstruidas (para depuración; nunca se registra en producción). */
  lines: string[];
}

/** Limpia una línea de OCR al alfabeto MRZ esperado. */
function cleanMrzLine(line: string): string {
  return line
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9<]/g, "");
}

/** Reconstruye las ~3 líneas de la zona legible por máquina desde el texto OCR crudo. */
function reconstructLines(rawText: string): string[] {
  const candidates = rawText
    .split(/\r?\n/)
    .map(cleanMrzLine)
    .filter((l) => l.length >= 18); // las líneas MRZ reales rondan 30 caracteres
  // Si el OCR fusionó todo en una sola línea larga, se intenta partir cada
  // ~30 caracteres como respaldo.
  if (candidates.length === 0) {
    const flat = cleanMrzLine(rawText);
    if (flat.length >= 54) {
      const chunks: string[] = [];
      for (let i = 0; i < flat.length; i += 30) chunks.push(flat.slice(i, i + 30));
      return chunks.filter((c) => c.length >= 18);
    }
    return [];
  }
  return candidates.slice(0, 4);
}

/**
 * El número de identidad (NI, 11 dígitos) va pegado sin separador al número
 * de documento + dígito de control en la línea 1 ("I<CUBA" + doc + NI +
 * relleno) — un simple "primera corrida de 11 dígitos" sobre TODO el texto
 * concatenado agarra el trozo equivocado, porque esa línea suele tener más
 * de 11 dígitos seguidos en total. El NI son siempre los ÚLTIMOS 11 dígitos
 * de esa línea (justo antes del relleno `<`), así que se localiza la línea
 * que contiene "CUBA" y se toma su cola numérica.
 */
function parseIdentityNumber(lines: string[]): string | null {
  const docLine = lines.find((l) => l.includes("CUBA") && /\d{11}/.test(l));
  if (docLine) {
    const trimmed = docLine.replace(/<+$/, "");
    const tail = /(\d{11})$/.exec(trimmed);
    if (tail) return tail[1];
    const runs = trimmed.match(/\d{11,}/g);
    if (runs && runs.length) return runs[runs.length - 1].slice(-11);
  }
  // Respaldo: cualquier corrida de exactamente 11 dígitos (ni más ni menos)
  // en el texto completo — evita agarrar un fragmento de una corrida más larga.
  const isolated = /(?<!\d)(\d{11})(?!\d)/.exec(lines.join(""));
  return isolated ? isolated[1] : null;
}

/**
 * El relleno `<<<<<<` del final de la línea de nombre a veces se lee como
 * letras ("YANELIS<K<LLLLLLLL"): una "palabra" de 3+ letras iguales no es un
 * nombre. Se descarta desde ahí hasta el final, junto con una letra suelta
 * justo antes (otro `<` mal leído).
 */
function dropFillerMisreads(tokens: string[]): string[] {
  const garbage = tokens.findIndex((t) => /^(.)\1{2,}$/.test(t));
  if (garbage === -1) return tokens;
  let end = garbage;
  if (end > 0 && tokens[end - 1].length === 1) end -= 1;
  return tokens.slice(0, end);
}

function parseNameLine(lines: string[]): string | null {
  // La línea de nombre tiene letras y `<` pero NO una corrida larga de dígitos,
  // y contiene el separador de bloque `<<`.
  const nameLine = lines.find(
    (l) => l.includes("<<") && !/\d{4,}/.test(l) && /[A-Z]{3,}/.test(l),
  );
  if (!nameLine) return null;

  const [surnameBlock, givenBlockRaw] = nameLine.split("<<");
  const surnames = dropFillerMisreads(surnameBlock.split("<").filter(Boolean));
  const givenBlock = (givenBlockRaw ?? "").replace(/<+$/, "");
  const givenNames = dropFillerMisreads(givenBlock.split("<").filter(Boolean));
  if (surnames.length === 0 && givenNames.length === 0) return null;

  const full = [...givenNames, ...surnames].join(" ");
  return full.length >= 3 ? titleCase(full) : null;
}

export function parseCubanMrzText(rawText: string): CubanMrzParse {
  const lines = reconstructLines(rawText);
  const joined = lines.join("");
  const data: ExtractedRecipientData = {};
  const fieldConfidence: CubanMrzParse["fieldConfidence"] = {};

  if (lines.length === 0) {
    return { data, fieldConfidence, lines };
  }

  // Número de identidad: alta confianza (alfabeto restringido a A-Z/0-9/<,
  // sin ambigüedad de letras parecidas a dígitos en este contexto numérico).
  const ni = parseIdentityNumber(lines);
  if (ni) {
    data.identityNumber = ni;
    fieldConfidence.identityNumber = 0.9;
  }

  // Nacimiento + sexo + vencimiento: YYMMDD + [dígito de control] + M|F +
  // YYMMDD. El carné real trae el dígito de control ("6503207F3011154");
  // sin contemplarlo, el patrón se corría un dígito y la fecha de
  // nacimiento salía inválida.
  const dates = /(\d{6})\d?([MF])(\d{6})/.exec(joined);
  if (dates) {
    const dob = normalizeMrzYyMmDd(dates[1]);
    const exp = normalizeMrzYyMmDd(dates[3]);
    if (dob) {
      data.dateOfBirth = dob;
      fieldConfidence.dateOfBirth = 0.75;
    }
    data.sex = dates[2] as "M" | "F";
    fieldConfidence.sex = 0.85;
    if (exp) {
      data.expirationDate = exp;
      fieldConfidence.expirationDate = 0.75;
    }
  }

  const fullName = parseNameLine(lines);
  if (fullName) {
    data.fullName = fullName;
    fieldConfidence.fullName = 0.85;
  }

  return { data, fieldConfidence, lines };
}

/**
 * Ejecuta el pipeline completo: recorta la franja inferior del reverso ya
 * recortado por el vendedor (varias proporciones, por si el encuadre varía),
 * OCR con alfabeto restringido A-Z/0-9/`<`, reconstruye líneas y parsea.
 * Combina las franjas campo por campo: cada campo lo aporta la PRIMERA franja
 * que lo lee (las ajustadas primero, que leen el nombre más limpio); las
 * anchas solo completan lo que falte (p. ej. el NI de la línea 1).
 */
export async function extractCubanMrz(
  backImageDataUrl: string,
): Promise<CubanMrzParse & { regionUsed: boolean }> {
  // Franjas más altas al final: si la foto no se recortó a la tarjeta (el
  // editor guarda la foto completa por defecto), la zona legible queda más
  // arriba del borde inferior y las franjas bajas cortan la línea del NI.
  const fractions = [0.3, 0.22, 0.38, 0.5, 0.65];
  const merged: CubanMrzParse & { regionUsed: boolean } = {
    data: {},
    fieldConfidence: {},
    lines: [],
    regionUsed: false,
  };

  for (const fraction of fractions) {
    try {
      const rect = await lowerBandRegion(backImageDataUrl, fraction);
      const working = await toOcrDataUrl(backImageDataUrl, {
        sourceRect: rect,
        maxWidth: 1600,
        contrast: 1.5,
      });
      const { text } = await recognizeText(working, "eng", {
        charWhitelist: MRZ_CHARSET,
      });
      const parsed = parseCubanMrzText(text);
      merged.regionUsed = true;
      if (merged.lines.length === 0) merged.lines = parsed.lines;
      for (const key of Object.keys(parsed.data) as (keyof ExtractedRecipientData)[]) {
        if (merged.data[key] !== undefined) continue;
        (merged.data as Record<string, unknown>)[key] = parsed.data[key];
        merged.fieldConfidence[key] = parsed.fieldConfidence[key];
      }
      // Con NI + nombre ya alcanzamos la máxima confianza útil: no hace
      // falta seguir probando franjas.
      if (merged.data.identityNumber && merged.data.fullName) break;
    } catch {
      /* se intenta la siguiente franja */
    }
  }

  return merged;
}
