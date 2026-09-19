import { ROUTES } from "@/lib/constants";
import { FilterSelect } from "@/components/ui/filter-select";
import { LOGISTICS_STATUS_FILTER_OPTIONS, COMMERCIAL_STATUS_OPTIONS, type LogisticsListQuery } from "@/lib/admin/logistics-list-params";
import type { SellerFilterOption } from "@/lib/admin/sellers";

export function LogisticsToolbar({ query, sellers }: { query: LogisticsListQuery; sellers: SellerFilterOption[] }) {
  return (
    <form method="get" action={ROUTES.adminLogistica} className="flex flex-wrap items-end gap-2">
      <div className="min-w-[200px] flex-1">
        <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Buscar</label>
        <input
          type="text"
          name="q"
          defaultValue={query.search}
          placeholder="N.º de venta, tracking, comprador, destinatario, vendedor, producto…"
          className="w-full rounded-md border px-2.5 py-1.5 text-sm border-border dark:bg-transparent"
        />
      </div>
      <FilterSelect label="Estado logístico" name="status" defaultValue={query.status} options={LOGISTICS_STATUS_FILTER_OPTIONS} />
      <FilterSelect label="Estado de venta" name="commercial" defaultValue={query.commercialStatus} options={COMMERCIAL_STATUS_OPTIONS} />
      <FilterSelect
        label="Vendedor"
        name="seller"
        defaultValue={query.sellerId ?? ""}
        options={[{ value: "", label: "Todos" }, ...sellers.map((s) => ({ value: s.id, label: s.name }))]}
      />
      <button type="submit" className="rounded-md border px-3 py-1.5 text-sm font-medium border-border bg-brand text-brand-foreground">
        Filtrar
      </button>
      {(query.status !== "ALL" || query.commercialStatus !== "ALL" || query.sellerId || query.search) && (
        <a href={ROUTES.adminLogistica} className="px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground">
          Limpiar
        </a>
      )}
    </form>
  );
}
