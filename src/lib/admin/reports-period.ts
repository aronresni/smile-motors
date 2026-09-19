import { resolveRange, shiftPeriod } from "@/lib/seller/period";

/**
 * Presets de período para /admin/reportes. El ANCLA ("hoy") SIEMPRE viene de
 * `getDealerToday()` (RPC, zona horaria del concesionario) — nunca de
 * `new Date()` del navegador/proceso Node. A partir de un ancla ya conocida,
 * la aritmética de calendario (semana/mes/año) es pura y no depende de zona
 * horaria — se reusa el mismo motor de `src/lib/seller/period.ts`.
 */
export type ReportPeriodPreset = "today" | "week" | "month" | "prevMonth" | "year" | "all" | "custom";

export const REPORT_PERIOD_OPTIONS: { value: ReportPeriodPreset; label: string }[] = [
  { value: "today", label: "Hoy" },
  { value: "week", label: "Esta semana" },
  { value: "month", label: "Mes actual" },
  { value: "prevMonth", label: "Mes anterior" },
  { value: "year", label: "Este año" },
  { value: "all", label: "Todos" },
  { value: "custom", label: "Rango personalizado" },
];

export interface ReportPeriod {
  preset: ReportPeriodPreset;
  start: string | null;
  end: string | null;
  label: string;
}

export function resolveReportPeriod(
  preset: ReportPeriodPreset,
  dealerToday: string,
  customStart?: string | null,
  customEnd?: string | null,
): ReportPeriod {
  switch (preset) {
    case "today": {
      const r = resolveRange({ kind: "day", anchor: dealerToday });
      return { preset, start: r.startISO, end: r.endISO, label: "Hoy" };
    }
    case "week": {
      const r = resolveRange({ kind: "week", anchor: dealerToday });
      return { preset, start: r.startISO, end: r.endISO, label: `Esta semana (${r.label})` };
    }
    case "month": {
      const r = resolveRange({ kind: "month", anchor: dealerToday });
      return { preset, start: r.startISO, end: r.endISO, label: `Mes actual (${r.label})` };
    }
    case "prevMonth": {
      const prevAnchor = shiftPeriod({ kind: "month", anchor: dealerToday }, -1).anchor;
      const r = resolveRange({ kind: "month", anchor: prevAnchor });
      return { preset, start: r.startISO, end: r.endISO, label: `Mes anterior (${r.label})` };
    }
    case "year": {
      const r = resolveRange({ kind: "year", anchor: dealerToday });
      return { preset, start: r.startISO, end: r.endISO, label: `Este año (${r.label})` };
    }
    case "custom": {
      const start = customStart || dealerToday;
      const end = customEnd || dealerToday;
      return { preset, start, end, label: `${start} a ${end}` };
    }
    case "all":
    default:
      return { preset: "all", start: null, end: null, label: "Todos" };
  }
}

type RawParams = Record<string, string | string[] | undefined>;
function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v ?? "").trim();
}
const PRESETS = new Set<ReportPeriodPreset>(["today", "week", "month", "prevMonth", "year", "all", "custom"]);

export function parseReportPeriodParams(raw: RawParams): { preset: ReportPeriodPreset; customStart: string | null; customEnd: string | null } {
  const presetRaw = first(raw.period);
  const preset = PRESETS.has(presetRaw as ReportPeriodPreset) ? (presetRaw as ReportPeriodPreset) : "month";
  return {
    preset,
    customStart: first(raw.start) || null,
    customEnd: first(raw.end) || null,
  };
}
