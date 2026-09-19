import { ROUTES } from "@/lib/constants";
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
      <div>
        <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Estado logístico</label>
        <select name="status" defaultValue={query.status} className="rounded-md border px-2.5 py-1.5 text-sm border-border dark:bg-transparent">
          {LOGISTICS_STATUS_FILTER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Estado de venta</label>
        <select name="commercial" defaultValue={query.commercialStatus} className="rounded-md border px-2.5 py-1.5 text-sm border-border dark:bg-transparent">
          {COMMERCIAL_STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Vendedor</label>
        <select name="seller" defaultValue={query.sellerId ?? ""} className="rounded-md border px-2.5 py-1.5 text-sm border-border dark:bg-transparent">
          <option value="">Todos</option>
          {sellers.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>
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
