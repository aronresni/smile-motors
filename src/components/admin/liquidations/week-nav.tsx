import Link from "next/link";
import { ROUTES } from "@/lib/constants";
import { resolveRange, shiftPeriod } from "@/lib/seller/period";

/**
 * Navegación semana a semana (lunes-domingo). `currentWeekStart` ("hoy" del
 * concesionario) llega SIEMPRE del servidor (`admin_liquidation_current_week`,
 * zona horaria del negocio) — nunca se calcula aquí con el reloj del
 * navegador. `resolveRange`/`shiftPeriod` son aritmética de calendario pura
 * sobre fechas ya conocidas (sin ambigüedad de zona horaria).
 */
export function WeekNav({ weekStart, currentWeekStart }: { weekStart: string; currentWeekStart: string }) {
  const period = { kind: "week" as const, anchor: weekStart };
  const range = resolveRange(period);
  const prev = shiftPeriod(period, -1).anchor;
  const next = shiftPeriod(period, 1).anchor;
  const isCurrentWeek = weekStart === currentWeekStart;

  return (
    <div className="flex items-center gap-2">
      <Link
        href={`${ROUTES.adminLiquidaciones}?week=${prev}`}
        className="rounded-md border px-2.5 py-1.5 text-sm border-border hover:bg-surface-elevated"
      >
        ← Semana anterior
      </Link>
      <span className="min-w-[140px] text-center text-sm font-medium tabular-nums">{range.label}</span>
      <Link
        href={`${ROUTES.adminLiquidaciones}?week=${next}`}
        className="rounded-md border px-2.5 py-1.5 text-sm border-border hover:bg-surface-elevated"
      >
        Semana siguiente →
      </Link>
      {!isCurrentWeek && (
        <Link
          href={`${ROUTES.adminLiquidaciones}?week=${currentWeekStart}`}
          className="rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          Hoy
        </Link>
      )}
    </div>
  );
}
