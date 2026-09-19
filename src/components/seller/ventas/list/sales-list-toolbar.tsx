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

  const selectClass =
    "w-full rounded-lg border border-border bg-surface-muted px-3 py-2 text-xs font-medium text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 sm:w-auto";

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
        <select
          aria-label="Filtrar por período"
          value={query.period === "custom" ? "all" : query.period}
          onChange={(e) =>
            navigate({
              period: e.target.value as SellerSalesListQuery["period"],
            })
          }
          className={selectClass}
        >
          {SALES_LIST_PERIOD_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              Período: {opt.label}
            </option>
          ))}
        </select>

        <select
          aria-label="Filtrar por estado"
          value={query.status}
          onChange={(e) =>
            navigate({
              status: e.target.value as SellerSalesListQuery["status"],
            })
          }
          className={selectClass}
        >
          {SALES_LIST_STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              Estado: {opt.label}
            </option>
          ))}
        </select>

        <select
          aria-label="Filtrar por tipo de operación"
          value={query.operation}
          onChange={(e) =>
            navigate({
              operation: e.target.value as SellerSalesListQuery["operation"],
            })
          }
          className={selectClass}
        >
          {SALES_LIST_OPERATION_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              Operación: {opt.label}
            </option>
          ))}
        </select>

        <select
          aria-label="Filtrar por financiación"
          value={query.financing}
          onChange={(e) =>
            navigate({
              financing: e.target.value as SellerSalesListQuery["financing"],
            })
          }
          className={selectClass}
        >
          {SALES_LIST_FINANCING_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              Financiación: {opt.label}
            </option>
          ))}
        </select>

        <select
          aria-label="Filtrar por estado de cobro"
          value={query.settlement}
          onChange={(e) =>
            navigate({
              settlement: e.target.value as SellerSalesListQuery["settlement"],
            })
          }
          className={selectClass}
        >
          {SALES_LIST_SETTLEMENT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              Cobro: {opt.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
