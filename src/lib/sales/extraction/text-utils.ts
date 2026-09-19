/** Capitaliza cada palabra; conserva acentos y la Ñ. */
export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/(^|[\s'-])([a-záéíóúñ])/g, (_m, sep, ch) => sep + ch.toUpperCase())
    .replace(/\s+/g, " ")
    .trim();
}

/** Colapsa espacios y recorta. */
export function squish(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
