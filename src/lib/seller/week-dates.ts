/**
 * Fechas de semana (lunes–domingo) para "Mis liquidaciones". Las fechas
 * `yyyy-mm-dd` son días calendario (sin zona); la semana de un INSTANTE se
 * calcula en la hora del concesionario, igual que la base de datos
 * (`_liquidation_week_of_instant`, America/New_York).
 */
export const DEALER_TIME_ZONE = "America/New_York";

export function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Lunes (yyyy-mm-dd) de la semana de un día calendario. */
export function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const offset = (d.getUTCDay() + 6) % 7; // lunes = 0
  return addDaysISO(iso, -offset);
}

/** Lunes de la semana de un instante, según el día LOCAL del concesionario. */
export function dealerWeekStartOfInstant(instant: string): string | null {
  const d = new Date(instant);
  if (Number.isNaN(d.getTime())) return null;
  const local = new Intl.DateTimeFormat("en-CA", {
    timeZone: DEALER_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  return mondayOf(local);
}

const DAY_MONTH = new Intl.DateTimeFormat("es-DO", { day: "numeric", month: "short", timeZone: "UTC" });
const FULL = new Intl.DateTimeFormat("es-DO", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** "14 sept – 20 sept 2026". */
export function formatWeekRange(start: string, end: string): string {
  return `${DAY_MONTH.format(new Date(`${start}T00:00:00Z`))} – ${FULL.format(new Date(`${end}T00:00:00Z`))}`;
}

/** "14 sept 2026". */
export function formatDay(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : FULL.format(d);
}
