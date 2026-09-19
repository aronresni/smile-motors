import { ROUTES } from "@/lib/constants";
import { FilterSelect } from "@/components/ui/filter-select";
import { REPORT_PERIOD_OPTIONS, type ReportPeriod, type ReportPeriodPreset } from "@/lib/admin/reports-period";

/** Selector de período — formulario GET nativo, preserva la pestaña activa.
 * El rango resuelto se muestra siempre explícitamente (nunca "confía" en que
 * el admin recuerde qué eligió). */
export function ReportPeriodPicker({ tab, period }: { tab: string; period: ReportPeriod }) {
  return (
    <form method="get" action={ROUTES.adminReportes} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="tab" value={tab} />
      <FilterSelect label="Período" name="period" defaultValue={period.preset} options={REPORT_PERIOD_OPTIONS} />
      {period.preset === ("custom" as ReportPeriodPreset) && (
        <>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Desde</label>
            <input type="date" name="start" defaultValue={period.start ?? ""} className="rounded-md border px-2.5 py-1.5 text-sm border-border dark:bg-transparent" />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Hasta</label>
            <input type="date" name="end" defaultValue={period.end ?? ""} className="rounded-md border px-2.5 py-1.5 text-sm border-border dark:bg-transparent" />
          </div>
        </>
      )}
      <button type="submit" className="rounded-md border px-3 py-1.5 text-sm font-medium border-border bg-brand text-brand-foreground">
        Aplicar
      </button>
      <p className="ml-auto text-xs text-muted-foreground">
        {period.start && period.end ? (
          <>Del <strong>{period.start}</strong> al <strong>{period.end}</strong> (hora del Este)</>
        ) : (
          "Todo el historial"
        )}
      </p>
    </form>
  );
}
