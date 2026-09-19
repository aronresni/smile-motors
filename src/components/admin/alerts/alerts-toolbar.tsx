import { ROUTES } from "@/lib/constants";
import { FilterSelect } from "@/components/ui/filter-select";
import { ALERT_CATEGORY_OPTIONS, ALERT_PRIORITY_OPTIONS, type AlertsListQuery } from "@/lib/admin/alerts-list-params";
import type { SellerFilterOption } from "@/lib/admin/sellers";

export function AlertsToolbar({ query, sellers }: { query: AlertsListQuery; sellers: SellerFilterOption[] }) {
  return (
    <form method="get" action={ROUTES.adminAlertas} className="flex flex-wrap items-end gap-2">
      <FilterSelect label="Categoría" name="category" defaultValue={query.category} options={ALERT_CATEGORY_OPTIONS} />
      <FilterSelect label="Prioridad" name="priority" defaultValue={query.priority} options={ALERT_PRIORITY_OPTIONS} />
      <FilterSelect
        label="Vendedor"
        name="seller"
        defaultValue={query.sellerId ?? ""}
        options={[{ value: "", label: "Todos" }, ...sellers.map((s) => ({ value: s.id, label: s.name }))]}
      />
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
