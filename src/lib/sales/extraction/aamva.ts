/**
 * Parser AAMVA (contenido del PDF417 de una licencia de conducir de EE. UU.).
 * Local, tolerante a versiones y campos faltantes. Nunca lanza por un campo
 * opcional ausente.
 *
 * Códigos soportados:
 *   DAC/DCT = nombre(s)          DCS/DAB = apellido(s)      DAD = segundo nombre
 *   DBB = fecha de nacimiento    DBA = fecha de expiración
 *   DAQ = n.º de licencia        DAG = dirección (calle)    DAH = dirección 2
 *   DAI = ciudad                 DAJ = estado               DAK = código postal
 */
import type { ExtractedDocumentData } from "@/lib/sales/types";
import { normalizeAamvaDate } from "@/lib/sales/extraction/date-normalize";
import { titleCase } from "@/lib/sales/extraction/text-utils";

function cleanZip(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length >= 5) return digits.slice(0, 5);
  return "";
}

export interface AamvaParseResult {
  data: ExtractedDocumentData;
  fieldsDetected: string[];
  fieldSources: Record<string, "pdf417">;
}

export function parseAamva(raw: string): AamvaParseResult | null {
  if (!raw || raw.length < 20) return null;
  // El payload AAMVA contiene el marcador "ANSI " en la cabecera.
  if (!/ANSI\s/i.test(raw) && !/^@/.test(raw)) return null;

  const fields: Record<string, string> = {};
  for (const line of raw.split(/[\r\n]+/)) {
    const trimmed = line.trim();
    const match = /^([A-Z]{3})(.*)$/.exec(trimmed);
    if (!match) continue;
    const code = match[1];
    const value = match[2].trim();
    if (value && fields[code] === undefined) fields[code] = value;
  }

  const data: ExtractedDocumentData = {};

  const firstName = fields.DAC ?? fields.DCT;
  const middleName = fields.DAD;
  const lastName = fields.DCS ?? fields.DAB;
  if (firstName) {
    // DAD (segundo nombre) solo se agrega si no viene ya incluido en DAC.
    const combined =
      middleName && !new RegExp(`\\b${middleName}\\b`, "i").test(firstName)
        ? `${firstName} ${middleName}`
        : firstName;
    data.firstName = titleCase(combined);
  }
  if (lastName) data.lastName = titleCase(lastName);

  const dob = fields.DBB ? normalizeAamvaDate(fields.DBB) : "";
  if (dob) data.dateOfBirth = dob;

  const exp = fields.DBA ? normalizeAamvaDate(fields.DBA) : "";
  if (exp) data.expirationDate = exp;

  if (fields.DAQ) data.documentNumber = fields.DAQ.replace(/\s+/g, "");

  if (fields.DAG) data.addressLine1 = titleCase(fields.DAG);
  if (fields.DAI) data.city = titleCase(fields.DAI);
  if (fields.DAJ && /^[A-Za-z]{2}$/.test(fields.DAJ)) {
    data.state = fields.DAJ.toUpperCase();
  }
  if (fields.DAK) {
    const zip = cleanZip(fields.DAK);
    if (zip) data.postalCode = zip;
  }

  const fieldsDetected = Object.keys(data);
  if (fieldsDetected.length === 0) return null;

  const fieldSources = Object.fromEntries(
    fieldsDetected.map((k) => [k, "pdf417" as const]),
  );

  return { data, fieldsDetected, fieldSources };
}
