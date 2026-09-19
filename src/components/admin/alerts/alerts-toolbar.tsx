import { ROUTES } from "@/lib/constants";
import { ALERT_CATEGORY_OPTIONS, ALERT_PRIORITY_OPTIONS, type AlertsListQuery } from "@/lib/admin/alerts-list-params";
import type { SellerFilterOption } from "@/lib/admin/sellers";

export function AlertsToolbar({ query, sellers }: { query: AlertsListQuery; sellers: SellerFilterOption[] }) {
  return (
    <form method="get" action={ROUTES.adminAlertas} className="flex flex-wrap items-end gap-2">
      <div>
        <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Categoría</label>
        <select
          name="category"
          defaultValue={query.category}
          className="rounded-md border px-2.5 py-1.5 text-sm border-border dark:bg-transparent"
        >
          {ALERT_CATEGORY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Prioridad</label>
        <select
          name="priority"
          defaultValue={query.priority}
          className="rounded-md border px-2.5 py-1.5 text-sm border-border dark:bg-transparent"
        >
          {ALERT_PRIORITY_OPTIONS.map((opt) => (
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
      <button
        type="submit"
        className="rounded-md border px-3 py-1.5 text-sm font-medium border-border bg-brand text-brand-foreground"
      >
        Filtrar
      </button>
      {(query.category !== "ALL" || query.priority !== "ALL" || query.sellerId) && (
        <a href={ROUTES.adminAlertas} className="px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground">
          Limpiar
        </a>
      )}
    </form>
  );
}
