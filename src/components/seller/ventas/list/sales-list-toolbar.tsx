"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { FilterSelect } from "@/components/ui/filter-select";
import {
  SALES_LIST_FINANCING_OPTIONS,
  SALES_LIST_OPERATION_OPTIONS,
  SALES_LIST_PERIOD_OPTIONS,
  SALES_LIST_SETTLEMENT_OPTIONS,
  SALES_LIST_STATUS_OPTIONS,
  buildSalesListHref,
  hasActiveSalesListFilters,
  parseSalesListSearchParams,
  type SellerSalesListQuery,
} from "@/lib/seller/sales-list-params";

const SEARCH_DEBOUNCE_MS = 350;

export function SalesListToolbar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const query: SellerSalesListQuery = useMemo(
    () => parseSalesListSearchParams(Object.fromEntries(searchParams.entries())),
    [searchParams],
  );

  // Borrador local del buscador (la URL va con retraso por el debounce).
  const [searchDraft, setSearchDraft] = useState(query.search);
  // Ajuste de estado en render (patrón recomendado por React) para
  // re-sincronizar el input cuando la URL cambia por fuera (botón atrás,
  // "Limpiar filtros"). NO se hace en un efecto.
  const [syncedSearch, setSyncedSearch] = useState(query.search);
  if (query.search !== syncedSearch) {
    setSyncedSearch(query.search);
    setSearchDraft(query.search);
  }

  const navigate = useCallback(
    (next: Partial<SellerSalesListQuery>) => {
      const href = buildSalesListHref(pathname, { ...query, page: 1, ...next });
      startTransition(() => router.push(href, { scroll: false }));
    },
    [pathname, query, router],
  );

  // Debounce del buscador: el `setTimeout` difiere la navegación fuera del render.
  useEffect(() => {
    const trimmed = searchDraft.trim();
    if (trimmed === query.search) return;
    const id = setTimeout(() => navigate({ search: trimmed }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [searchDraft, query.search, navigate]);

  const clearAll = useCallback(() => {
    setSearchDraft("");
    setSyncedSearch("");
    startTransition(() => router.push(pathname, { scroll: false }));
  }, [pathname, router]);

  const filtersActive = hasActiveSalesListFilters(query);

  return (
    <div
      className={cn(
        "space-y-2.5 rounded-2xl border border-border bg-surface p-2.5 transition-opacity",
        isPending && "opacity-70",
      )}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="relative flex-1">
          <span className="sr-only">Buscar venta</span>
          <input
            type="search"
            inputMode="search"
            autoComplete="off"
            placeholder="Buscar por cliente, modelo, Nº de venta, tracking o financiera…"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </label>

        {filtersActive && (
          <button
            type="button"
            onClick={clearAll}
            className="shrink-0 rounded-lg border border-border px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:text-foreground"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <FilterSelect
          ariaLabel="Filtrar por período"
          prefix="Período"
          value={query.period === "custom" ? "all" : query.period}
          onValueChange={(v) => navigate({ period: v as SellerSalesListQuery["period"] })}
          options={SALES_LIST_PERIOD_OPTIONS}
          className="sm:w-auto"
        />
        <FilterSelect
          ariaLabel="Filtrar por estado"
          prefix="Estado"
          value={query.status}
          onValueChange={(v) => navigate({ status: v as SellerSalesListQuery["status"] })}
          options={SALES_LIST_STATUS_OPTIONS}
          className="sm:w-auto"
        />
        <FilterSelect
          ariaLabel="Filtrar por tipo de operación"
          prefix="Operación"
          value={query.operation}
          onValueChange={(v) => navigate({ operation: v as SellerSalesListQuery["operation"] })}
          options={SALES_LIST_OPERATION_OPTIONS}
          className="sm:w-auto"
        />
        <FilterSelect
          ariaLabel="Filtrar por financiación"
          prefix="Financiación"
          value={query.financing}
          onValueChange={(v) => navigate({ financing: v as SellerSalesListQuery["financing"] })}
          options={SALES_LIST_FINANCING_OPTIONS}
          className="sm:w-auto"
        />
        <FilterSelect
          ariaLabel="Filtrar por estado de cobro"
          prefix="Cobro"
          value={query.settlement}
          onValueChange={(v) => navigate({ settlement: v as SellerSalesListQuery["settlement"] })}
          options={SALES_LIST_SETTLEMENT_OPTIONS}
          className="sm:w-auto"
        />
      </div>
    </div>
  );
}
