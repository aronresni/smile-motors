import { ROUTES } from "@/lib/constants";

/** Enlace de exportación — navegación normal (no fetch), respeta período y
 * filtros actuales, generado 100% server-side (ver route.ts de export). */
export function ExportCsvLink({ report, start, end }: { report: string; start: string | null; end: string | null }) {
  const qs = new URLSearchParams({ report, ...(start ? { start } : {}), ...(end ? { end } : {}) });
  return (
    <a
      href={`${ROUTES.adminReportes}/export?${qs.toString()}`}
      className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium border-border hover:bg-surface-elevated"
    >
      Exportar CSV ↓
    </a>
  );
}
