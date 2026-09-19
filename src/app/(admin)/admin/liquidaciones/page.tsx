import type { Metadata } from "next";
import { getCurrentLiquidationWeek, getLiquidationWeekList } from "@/lib/admin/liquidations";
import { WeekNav } from "@/components/admin/liquidations/week-nav";
import { LiquidationWeekTable } from "@/components/admin/liquidations/liquidation-week-table";

export const metadata: Metadata = { title: "Liquidaciones · Admin" };
export const dynamic = "force-dynamic";

export default async function AdminLiquidacionesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.week) ? sp.week[0] : sp.week;
  // Sin parámetro explícito: NUNCA se calcula "hoy" en JS (dependería de la
  // zona horaria del proceso Node) — la RPC decide "hoy" server-side, en la
  // zona horaria del concesionario. `_liquidation_week_start` normaliza
  // cualquier fecha explícita a su lunes (aritmética de calendario pura).
  const explicitWeekStart = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;

  const [{ rows, weekStart, weekClosed }, currentWeek] = await Promise.all([
    getLiquidationWeekList(explicitWeekStart),
    getCurrentLiquidationWeek(),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Liquidaciones</h1>
          <p className="text-sm text-muted-foreground">
            Agrupa comisiones ya ELEGIBLES en un pago semanal por vendedor. La actividad Pending/Sold es informativa —
            nunca suma al monto a pagar.
          </p>
        </div>
        <WeekNav weekStart={weekStart} currentWeekStart={currentWeek?.weekStart ?? weekStart} />
      </div>

      {!weekClosed && (
        <p className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium border-info/30 bg-info/10 text-info">
          Semana en curso — las liquidaciones de esta semana solo pueden crearse/ajustarse; se aprueban al cerrar.
        </p>
      )}

      <LiquidationWeekTable rows={rows} weekStart={weekStart} />
    </div>
  );
}
