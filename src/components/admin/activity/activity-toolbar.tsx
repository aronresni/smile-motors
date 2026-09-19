import { ROUTES } from "@/lib/constants";
import { ACTIVITY_CATEGORY_OPTIONS, type ActivityListQuery } from "@/lib/admin/activity-list-params";
import type { SellerFilterOption } from "@/lib/admin/sellers";

/** Barra de filtros — formulario GET nativo (sin JS), mismo patrón que el
 * resto de los listados admin. */
export function ActivityToolbar({ query, sellers }: { query: ActivityListQuery; sellers: SellerFilterOption[] }) {
  return (
    <form method="get" action={ROUTES.adminActividad} className="flex flex-wrap items-end gap-2">
      <div className="min-w-[160px] flex-1">
        <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Buscar</label>
        <input
          type="text"
          name="q"
          defaultValue={query.search}
          placeholder="Venta, vendedor, producto, proveedor…"
          className="w-full rounded-md border px-2.5 py-1.5 text-sm border-border dark:bg-transparent"
        />
      </div>
      <div>
        <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Categoría</label>
        <select
          name="category"
          defaultValue={query.category}
          className="rounded-md border px-2.5 py-1.5 text-sm border-border dark:bg-transparent"
        >
          {ACTIVITY_CATEGORY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Vendedor</label>
        <select
          name="seller"
          defaultValue={query.sellerId ?? ""}
          className="rounded-md border px-2.5 py-1.5 text-sm border-border dark:bg-transparent"
        >
          <option value="">Todos</option>
          {sellers.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Desde</label>
        <input
          type="date"
          name="start"
          defaultValue={query.startDate ?? ""}
          className="rounded-md border px-2.5 py-1.5 text-sm border-border dark:bg-transparent"
        />
      </div>
      <div>
        <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Hasta</label>
        <input
          type="date"
          name="end"
          defaultValue={query.endDate ?? ""}
          className="rounded-md border px-2.5 py-1.5 text-sm border-border dark:bg-transparent"
        />
      </div>
      <button
        type="submit"
        className="rounded-md border px-3 py-1.5 text-sm font-medium border-border bg-brand text-brand-foreground"
      >
        Filtrar
      </button>
      {(query.category !== "ALL" || query.sellerId || query.search || query.startDate || query.endDate) && (
        <a href={ROUTES.adminActividad} className="px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground">
          Limpiar
        </a>
      )}
    </form>
  );
}
