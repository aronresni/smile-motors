/**
 * Parser LOCAL del texto OCR de un carné de identidad cubano.
 * Independiente del parser AAMVA.
 *
 * Solo se extrae lo que aparece impreso y se detecta con razonable confianza.
 * NO se infiere nada del número de CI (ni fecha de nacimiento, ni sexo, ni
 * provincia/municipio): esas reglas se implementarían y verificarían aparte.
 */
import type { ExtractedRecipientData } from "@/lib/sales/types";
import { normalizeLooseDate } from "@/lib/sales/extraction/date-normalize";
import { squish, titleCase } from "@/lib/sales/extraction/text-utils";

export interface CubanIdParse {
  data: ExtractedRecipientData;
  fieldConfidence: Partial<Record<keyof ExtractedRecipientData, number>>;
}

/**
 * El carné cubano imprime etiquetas bilingües como "NOMBRE / FIRST NAME" o
 * "APELLIDOS / LAST NAME": lo que queda tras la etiqueta en español es solo
 * la mitad en inglés de la MISMA etiqueta, no un valor. Sin este filtro se
 * devolvía literalmente "/ First Name" como si fuera el dato.
 */
function looksLikeLabelRemainder(rest: string): boolean {
  return /^\/\s*[A-Za-zÁÉÍÓÚÑáéíóúñ\s]{2,30}$/.test(rest);
}

function textAfterLabel(lines: string[], label: RegExp): string {
  for (let i = 0; i < lines.length; i++) {
    const m = label.exec(lines[i]);
    if (!m) continue;
    const rest = lines[i]
      .slice((m.index ?? 0) + m[0].length)
      .replace(/^[:\-\s.]+/, "")
      .trim();
    if (rest.length >= 2 && !looksLikeLabelRemainder(rest)) return rest;
    if (i + 1 < lines.length && lines[i + 1].length >= 2) {
      return lines[i + 1].trim();
    }
  }
  return "";
}

export function parseCubanIdentityText(
  text: string,
  baseConfidence: number,
): CubanIdParse {
  const data: ExtractedRecipientData = {};
  const fieldConfidence: CubanIdParse["fieldConfidence"] = {};
  const raw = text.replace(/\r/g, "");
  const upper = raw.toUpperCase();
  const lines = raw
    .split("\n")
    .map((l) => squish(l))
    .filter(Boolean);

  // --- Número de CI: 11 dígitos consecutivos ---
  const labelled = /(?:CI|IDENTIDAD|CARN[EÉ])\D{0,8}(\d{11})\b/i.exec(
    upper.replace(/\s+/g, " "),
  );
  const anyEleven = /(?:^|\D)(\d{11})(?:\D|$)/.exec(
    upper.replace(/[ \t]+/g, ""),
  );
  const ci = labelled?.[1] ?? anyEleven?.[1];
  if (ci) {
    data.identityNumber = ci;
    fieldConfidence.identityNumber = labelled
      ? baseConfidence * 0.92
      : baseConfidence * 0.7;
  }

  // --- Nombre completo ---
  const apellidos = textAfterLabel(lines, /APELLIDOS?/i);
  const nombres = textAfterLabel(lines, /NOMBRES?/i);
  if (apellidos || nombres) {
    const full = squish([nombres, apellidos].filter(Boolean).join(" "));
    if (full.length >= 3) {
      data.fullName = titleCase(full);
      fieldConfidence.fullName = baseConfidence * 0.78;
    }
  } else {
    const nameLines = lines
      .slice(0, 8)
      .filter(
        (l) =>
          /^[A-ZÁÉÍÓÚÑ' .\-]{4,40}$/.test(l) &&
          !/CARN|IDENTIDAD|REP[UÚ]BLICA|CUBA|MININT|MINISTERIO|INTERIOR/i.test(l),
      )
      .sort((a, b) => b.length - a.length)
      .slice(0, 2)
      .reverse();
    if (nameLines.length) {
      data.fullName = titleCase(squish(nameLines.join(" ")));
      fieldConfidence.fullName = baseConfidence * 0.5;
    }
  }

  // --- Fecha de nacimiento SOLO si está etiquetada (convención cubana DD/MM/YYYY) ---
  const dobMatch =
    /(?:FECHA DE NACIMIENTO|NACIMIENTO|NACID[OA])\b[^\d]{0,12}(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4}|\d{4}[/.\-]\d{1,2}[/.\-]\d{1,2})/i.exec(
      raw,
    );
  if (dobMatch) {
    const iso = normalizeLooseDate(dobMatch[1], "CU");
    if (iso) {
      data.dateOfBirth = iso;
      fieldConfidence.dateOfBirth = baseConfidence * 0.7;
    }
  }

  // --- Fecha de vencimiento (etiquetada "FECHA DE VENCIMIENTO") ---
  const expMatch =
    /(?:FECHA DE VENCIMIENTO|VENCIMIENTO|VENCE)\b[^\d]{0,12}(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4})/i.exec(
      raw,
    );
  if (expMatch) {
    const iso = normalizeLooseDate(expMatch[1], "CU");
    if (iso) {
      data.expirationDate = iso;
      fieldConfidence.expirationDate = baseConfidence * 0.75;
    }
  }

  // --- Registro civil / provincia de inscripción (solo etiquetado) ---
  const registry = textAfterLabel(lines, /REGISTRO\s+CIVIL/i);
  if (registry && /^[A-ZÁÉÍÓÚÑ' .\-]{3,30}$/.test(registry)) {
    data.registryProvince = titleCase(registry);
    fieldConfidence.registryProvince = baseConfidence * 0.6;
  }

  // --- Sexo (etiquetado "SEXO") ---
  const sexMatch = /\bSEXO\b\s*[:\-]?\s*([MF])\b/i.exec(upper);
  if (sexMatch) {
    data.sex = sexMatch[1].toUpperCase() as "M" | "F";
    fieldConfidence.sex = baseConfidence * 0.8;
  }

  // --- Dirección impresa (solo etiquetada). NO se aplica al campo de entrega
  //     del formulario; se guarda para revisión del vendedor. ---
  const dir = textAfterLabel(lines, /DIRECCI[OÓ]N(?: PARTICULAR)?/i);
  if (dir && dir.length >= 6) {
    data.address = titleCase(dir);
    fieldConfidence.address = baseConfidence * 0.55;
  }

  return { data, fieldConfidence };
}
