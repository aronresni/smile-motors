import {
  COMMISSION_STATUS_OPTIONS,
  type CommissionListQuery,
} from "@/lib/admin/commissions-list-params";
import { FilterSelect } from "@/components/ui/filter-select";

/** Búsqueda + filtro de estado server-side (formulario GET nativo, sin JS
 * — mismo patrón ya usado en el Centro de Aprobaciones). */
export function CommissionListToolbar({ query }: { query: CommissionListQuery }) {
  return (
    <form method="GET" className="flex flex-wrap items-center gap-2">
      <input
        type="search"
        name="q"
        defaultValue={query.search}
        placeholder="Buscar por N° de venta, vendedor, producto o tracking…"
        className="w-full max-w-sm rounded-lg border px-3 py-2 text-sm placeholder:text-muted-foreground border-border bg-surface text-foreground"
      />
      <FilterSelect
        prefix="Estado"
        ariaLabel="Filtrar por estado"
        name="status"
        defaultValue={query.status}
        options={COMMISSION_STATUS_OPTIONS}
        containerClassName="w-full sm:w-auto"
      />
      <button
        type="submit"
        className="shrink-0 rounded-lg border px-3 py-2 text-xs font-medium border-border text-text-secondary hover:bg-surface-elevated"
      >
        Buscar
      </button>
    </form>
  );
}
