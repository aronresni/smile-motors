/**
 * Motor de períodos del panel (DÍA / SEM / MES / AÑO).
 *
 * Todo el cálculo es puro y determinista a partir de `Period.anchor` (una
 * fecha ISO `yyyy-mm-dd`). No usa `Date.now()`, así el render de servidor y el
 * de cliente coinciden para un mismo `Period`.
 */

import type { SalesActivityBucket } from "@/lib/seller/types";

export type PeriodKind = "day" | "week" | "month" | "year";

export interface Period {
  kind: PeriodKind;
  /** Fecha ISO (yyyy-mm-dd) contenida en el período. */
  anchor: string;
}

export interface PeriodRange {
  kind: PeriodKind;
  /** ISO yyyy-mm-dd del primer día (incl.). */
  startISO: string;
  /** ISO yyyy-mm-dd del último día (incl.). */
  endISO: string;
  /** Texto listo para la UI, p. ej. "09/07 – 09/13". */
  label: string;
}

export const PERIOD_OPTIONS: { kind: PeriodKind; short: string; long: string }[] = [
  { kind: "day", short: "DÍA", long: "Día" },
  { kind: "week", short: "SEM", long: "Semana" },
  { kind: "month", short: "MES", long: "Mes" },
  { kind: "year", short: "AÑO", long: "Año" },
];

const MONTHS_ES = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
];

const WEEKDAYS_ES = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toISO(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Parsea `yyyy-mm-dd` como fecha UTC a medianoche (evita saltos de zona). */
function parseISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
}

function mmdd(iso: string): string {
  const d = parseISO(iso);
  return `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}`;
}

/** Índice de día de semana con lunes = 0. */
function weekdayMondayBased(d: Date): number {
  return (d.getUTCDay() + 6) % 7;
}

export function todayISO(reference: Date = new Date()): string {
  return toISO(
    new Date(
      Date.UTC(
        reference.getFullYear(),
        reference.getMonth(),
        reference.getDate(),
      ),
    ),
  );
}

export function defaultPeriod(reference: Date = new Date()): Period {
  return { kind: "week", anchor: todayISO(reference) };
}

export function resolveRange(period: Period): PeriodRange {
  const anchor = parseISO(period.anchor);

  if (period.kind === "day") {
    const iso = toISO(anchor);
    return { kind: "day", startISO: iso, endISO: iso, label: mmdd(iso) };
  }

  if (period.kind === "week") {
    const start = new Date(anchor);
    start.setUTCDate(start.getUTCDate() - weekdayMondayBased(anchor));
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 6);
    return {
      kind: "week",
      startISO: toISO(start),
      endISO: toISO(end),
      label: `${mmdd(toISO(start))} – ${mmdd(toISO(end))}`,
    };
  }

  if (period.kind === "month") {
    const start = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
    const end = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0));
    return {
      kind: "month",
      startISO: toISO(start),
      endISO: toISO(end),
      label: `${MONTHS_ES[start.getUTCMonth()]} ${start.getUTCFullYear()}`,
    };
  }

  // year
  const start = new Date(Date.UTC(anchor.getUTCFullYear(), 0, 1));
  const end = new Date(Date.UTC(anchor.getUTCFullYear(), 11, 31));
  return {
    kind: "year",
    startISO: toISO(start),
    endISO: toISO(end),
    label: String(start.getUTCFullYear()),
  };
}

/** Mueve el período una unidad hacia atrás (-1) o adelante (+1). */
export function shiftPeriod(period: Period, direction: -1 | 1): Period {
  const d = parseISO(period.anchor);
  switch (period.kind) {
    case "day":
      d.setUTCDate(d.getUTCDate() + direction);
      break;
    case "week":
      d.setUTCDate(d.getUTCDate() + direction * 7);
      break;
    case "month":
      d.setUTCMonth(d.getUTCMonth() + direction);
      break;
    case "year":
      d.setUTCFullYear(d.getUTCFullYear() + direction);
      break;
  }
  return { kind: period.kind, anchor: toISO(d) };
}

/** Cambia el tipo de período conservando el ancla. */
export function withKind(period: Period, kind: PeriodKind): Period {
  return { kind, anchor: period.anchor };
}

/**
 * Etiquetas de los intervalos (buckets) en que se divide el período para los
 * gráficos de actividad. La agregación real se hará en el backend; esto define
 * el eje X.
 */
export function bucketLabels(range: PeriodRange): string[] {
  switch (range.kind) {
    case "day":
      // Bloques de 3 horas.
      return ["00", "03", "06", "09", "12", "15", "18", "21"];
    case "week":
      return [...WEEKDAYS_ES];
    case "month": {
      const start = parseISO(range.startISO);
      const end = parseISO(range.endISO);
      const weeks = Math.ceil(
        (weekdayMondayBased(start) + end.getUTCDate()) / 7,
      );
      return Array.from({ length: weeks }, (_, i) => `Sem ${i + 1}`);
    }
    case "year":
      return [...MONTHS_ES];
  }
}

/** Período inmediatamente anterior, de la misma longitud. */
export function previousRange(range: PeriodRange): PeriodRange {
  const prev = shiftPeriod({ kind: range.kind, anchor: range.startISO }, -1);
  return resolveRange(prev);
}

/**
 * Reparte filas diarias `{ date, cuba, usa, local }` en los buckets de
 * visualización del gráfico de actividad, según el tipo de período.
 */
export function bucketizeDailyActivity(
  range: PeriodRange,
  rows: { date: string; cuba: number; usa: number; local: number }[],
): { buckets: SalesActivityBucket[]; totalUnits: number } {
  const labels = bucketLabels(range);
  const buckets: SalesActivityBucket[] = labels.map((label) => ({
    label,
    cuba: 0,
    usa: 0,
    local: 0,
  }));

  const indexOf = (iso: string): number => {
    const d = parseISO(iso);
    switch (range.kind) {
      case "day":
        return 0;
      case "week":
        return weekdayMondayBased(d); // 0..6
      case "month": {
        const monthStart = parseISO(range.startISO);
        return Math.min(
          buckets.length - 1,
          Math.floor(
            (weekdayMondayBased(monthStart) + d.getUTCDate() - 1) / 7,
          ),
        );
      }
      case "year":
        return d.getUTCMonth(); // 0..11
    }
  };

  let totalUnits = 0;
  for (const row of rows) {
    const i = indexOf(row.date);
    if (i < 0 || i >= buckets.length) continue;
    buckets[i].cuba += row.cuba;
    buckets[i].usa += row.usa;
    buckets[i].local += row.local;
    totalUnits += row.cuba + row.usa + row.local;
  }
  return { buckets, totalUnits };
}

/** Etiqueta de las semanas de la tendencia de liquidación (~8 semanas). */
export function liquidationWeekLabels(
  range: PeriodRange,
  count = 8,
): { weekStartISO: string; label: string }[] {
  const anchor = parseISO(range.endISO);
  const lastMonday = new Date(anchor);
  lastMonday.setUTCDate(lastMonday.getUTCDate() - weekdayMondayBased(anchor));

  const weeks: { weekStartISO: string; label: string }[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const wk = new Date(lastMonday);
    wk.setUTCDate(wk.getUTCDate() - i * 7);
    weeks.push({ weekStartISO: toISO(wk), label: mmdd(toISO(wk)) });
  }
  return weeks;
}
