/**
 * Utilidades monetarias en CENTAVOS (enteros) para evitar errores de coma
 * flotante. El estado del formulario guarda importes como `number` de centavos;
 * el formateo a "$1,234.56" ocurre solo en la capa de presentación.
 */

/** Convierte una entrada de usuario ("1,234.5", "$1234", "") a centavos. */
export function parseAmountToCents(input: string): number {
  const cleaned = input.replace(/[^0-9.]/g, "");
  if (!cleaned) return 0;
  const value = Number.parseFloat(cleaned);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * 100);
}

/**
 * Lectura ESTRICTA de un importe escrito por el usuario → centavos, sin
 * aritmética de punto flotante. Acepta "4500", "4,500", "4500.5", "$4,500.00";
 * devuelve `null` si el texto no es un importe válido (letras, varios puntos,
 * más de 2 decimales, separadores de miles mal colocados…). "" → `null`.
 */
export function parseMoneyInputStrict(input: string): number | null {
  const s = input.trim().replace(/^\$\s*/, "");
  if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/.test(s)) return null;
  const [intPart, decPart = ""] = s.replace(/,/g, "").split(".");
  const cents = Number(intPart) * 100 + Number(decPart.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** Centavos → número decimal (para inputs controlados). */
export function centsToAmount(cents: number): number {
  return Math.round(cents) / 100;
}

/** Centavos → texto para input editable, sin símbolo: "1234.50". */
export function centsToInputvalue(cents: number): string {
  if (!cents) return "";
  return (Math.round(cents) / 100).toFixed(2);
}

/** Centavos → moneda formateada: 123456 → "$1,234.56". */
export function formatCents(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(Math.round(cents) / 100);
}

/** Suma segura de una lista de centavos. */
export function sumCents(values: number[]): number {
  return values.reduce((acc, n) => acc + Math.round(n || 0), 0);
}

/** Multiplica centavos por una cantidad entera de forma segura. */
export function multiplyCents(cents: number, quantity: number): number {
  return Math.round(cents) * Math.max(0, Math.trunc(quantity || 0));
}
