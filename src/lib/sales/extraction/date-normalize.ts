/**
 * Normalización de fechas a `YYYY-MM-DD`.
 * Nunca adivina una fecha ambigua o inválida: devuelve "" si no hay confianza.
 *
 * IMPORTANTE: la licencia de EE. UU. imprime fechas en `MM/DD/YYYY`; el carné
 * cubano las imprime en `DD/MM/YYYY`. Nunca se aplica la misma convención a
 * ambos — cada documento pasa su propio `country` a `normalizeLooseDate`.
 */

function isRealDate(year: number, month: number, day: number): boolean {
  if (year < 1900 || year > 2100) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

function iso(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(
    day,
  ).padStart(2, "0")}`;
}

/**
 * Fechas AAMVA: 8 dígitos. Las licencias de EE. UU. usan `MMDDCCYY`;
 * algunas jurisdicciones (Canadá) usan `CCYYMMDD`. Se prueba primero el
 * formato de EE. UU. y, si no es válido, el ISO.
 */
export function normalizeAamvaDate(raw: string): string {
  const d = (raw ?? "").replace(/\D/g, "");
  if (d.length !== 8) return "";

  const mdy = {
    y: Number(d.slice(4, 8)),
    m: Number(d.slice(0, 2)),
    d: Number(d.slice(2, 4)),
  };
  if (isRealDate(mdy.y, mdy.m, mdy.d)) return iso(mdy.y, mdy.m, mdy.d);

  const ymd = {
    y: Number(d.slice(0, 4)),
    m: Number(d.slice(4, 6)),
    d: Number(d.slice(6, 8)),
  };
  if (isRealDate(ymd.y, ymd.m, ymd.d)) return iso(ymd.y, ymd.m, ymd.d);

  return "";
}

export type DateCountryContext = "US" | "CU";

/**
 * Fechas leídas por OCR con separador (`/`, `.`, `-`): solo se aceptan
 * formatos con AÑO DE 4 DÍGITOS para evitar ambigüedad. El orden día/mes
 * para el par ambiguo `NN/NN/YYYY` depende del documento:
 *   US → se interpreta MM/DD/YYYY primero (convención de la licencia).
 *   CU → se interpreta DD/MM/YYYY primero (convención del carné).
 * Si el primer candidato no es una fecha real pero el segundo sí, se usa el
 * segundo (p. ej. "31/01/2030" en un documento US igual se resuelve como
 * 31 de enero, porque 31 no puede ser mes).
 */
export function normalizeLooseDate(
  raw: string,
  country: DateCountryContext = "US",
): string {
  const s = (raw ?? "").trim();
  if (!s) return "";

  let m = /^(\d{4})[/.\-](\d{1,2})[/.\-](\d{1,2})$/.exec(s);
  if (m) {
    const [, y, mo, da] = m;
    if (isRealDate(+y, +mo, +da)) return iso(+y, +mo, +da);
    return "";
  }

  m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(s);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = Number(m[3]);
    const [firstAsMonth, secondAsMonth] =
      country === "CU" ? [b, a] : [a, b];
    const [firstDay, secondDay] = country === "CU" ? [a, b] : [b, a];
    if (isRealDate(y, firstAsMonth, firstDay)) return iso(y, firstAsMonth, firstDay);
    if (isRealDate(y, secondAsMonth, secondDay)) return iso(y, secondAsMonth, secondDay);
    return "";
  }

  return "";
}

/**
 * Fechas de 6 dígitos `YYMMDD` (segunda línea de la zona legible por máquina
 * del carné cubano: nacimiento y vencimiento). El siglo se infiere con la
 * heurística habitual de MRZ: si el año de 2 dígitos queda "en el futuro"
 * respecto al actual, se asume 1900s; si no, 2000s. Es una heurística de
 * apoyo — el valor se marca como fuente estructurada de todos modos porque
 * los 6 dígitos en sí vienen de una lectura de alta confianza.
 */
export function normalizeMrzYyMmDd(
  raw: string,
  reference: Date = new Date(),
): string {
  const d = (raw ?? "").replace(/\D/g, "");
  if (d.length !== 6) return "";
  const yy = Number(d.slice(0, 2));
  const month = Number(d.slice(2, 4));
  const day = Number(d.slice(4, 6));
  const currentYy = reference.getUTCFullYear() % 100;
  const century = yy > currentYy + 20 ? 1900 : 2000;
  const year = century + yy;
  if (!isRealDate(year, month, day)) return "";
  return iso(year, month, day);
}
