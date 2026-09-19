"use client";

import { FilterSelect } from "@/components/ui/filter-select";
import { useCallback, useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ADMIN_COLLECTION_OPTIONS,
  ADMIN_FINANCING_OPTIONS,
  ADMIN_PERIOD_OPTIONS,
  ADMIN_SALE_STATUS_OPTIONS,
  buildAdminSalesListHref,
  hasActiveAdminSalesListFilters,
  parseAdminSalesListSearchParams,
  type AdminSalesListQuery,
} from "@/lib/admin/sales-list-params";
import type { AdminSellerOption } from "@/lib/admin/sales-list";

const SEARCH_DEBOUNCE_MS = 350;

export function AdminSalesListToolbar({ sellers }: { sellers: AdminSellerOption[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const query: AdminSalesListQuery = parseAdminSalesListSearchParams(
    Object.fromEntries(searchParams.entries()),
  );

  const [searchDraft, setSearchDraft] = useState(query.search);
  const [syncedSearch, setSyncedSearch] = useState(query.search);
  if (query.search !== syncedSearch) {
    setSyncedSearch(query.search);
    setSearchDraft(query.search);
  }

  const navigate = useCallback(
    (next: Partial<AdminSalesListQuery>) => {
      const href = buildAdminSalesListHref(pathname, { ...query, page: 1, ...next });
      startTransition(() => router.push(href, { scroll: false }));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `query` se deriva de searchParams en cada render
    [pathname, router, searchParams],
  );

  useEffect(() => {
    const trimmed = searchDraft.trim();
    if (trimmed === query.search) return;
    const id = setTimeout(() => navigate({ search: trimmed }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft]);

  const clearAll = useCallback(() => {
    setSearchDraft("");
    setSyncedSearch("");
    startTransition(() => router.push(pathname, { scroll: false }));
  }, [pathname, router]);

  const filtersActive = hasActiveAdminSalesListFilters(query);

  return (
    <div
      className={`space-y-2.5 rounded-xl border p-2.5 transition-opacity border-border ${isPending ? "opacity-70" : ""}`}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="relative flex-1">
          <span className="sr-only">Buscar venta</span>
          <input
            type="search"
            inputMode="search"
            autoComplete="off"
            placeholder="Buscar por N.º de venta, cliente, vendedor, modelo, tracking o financiera…"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-sm placeholder:text-muted-foreground border-border bg-surface text-foreground"
          />
        </label>
        {filtersActive && (
          <button
            type="button"
            onClick={clearAll}
            className="shrink-0 rounded-lg border px-3 py-2 text-xs font-medium text-muted-foreground transition-colors border-border hover:text-foreground"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <FilterSelect
          ariaLabel="Filtrar por período"
          prefix="Período"
          value={query.period === "custom" ? "all" : query.period}
          onValueChange={(v) => navigate({ period: v as AdminSalesListQuery["period"] })}
          options={ADMIN_PERIOD_OPTIONS}
          className="sm:w-auto"
        />

        <FilterSelect
          ariaLabel="Filtrar por estado de venta"
          prefix="Estado"
          value={query.saleStatus}
          onValueChange={(v) => navigate({ saleStatus: v as AdminSalesListQuery["saleStatus"] })}
          options={ADMIN_SALE_STATUS_OPTIONS}
          className="sm:w-auto"
        />

        <FilterSelect
          ariaLabel="Filtrar por estado de cobro"
          prefix="Cobro"
          value={query.collection}
          onValueChange={(v) => navigate({ collection: v as AdminSalesListQuery["collection"] })}
          options={ADMIN_COLLECTION_OPTIONS}
          className="sm:w-auto"
        />

        <FilterSelect
          ariaLabel="Filtrar por financiación"
          prefix="Financiación"
          value={query.financing}
          onValueChange={(v) => navigate({ financing: v as AdminSalesListQuery["financing"] })}
          options={ADMIN_FINANCING_OPTIONS}
          className="sm:w-auto"
        />

        <FilterSelect
          ariaLabel="Filtrar por vendedor"
          value={query.sellerId ?? ""}
          onValueChange={(v) => navigate({ sellerId: v || null })}
          options={[{ value: "", label: "Vendedor: todos" }, ...sellers.map((s) => ({ value: s.id, label: s.fullName ?? s.id }))]}
          className="sm:w-auto"
        />
      </div>
    </div>
  );
}
