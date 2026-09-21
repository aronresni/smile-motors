"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { FilterSelect } from "@/components/ui/filter-select";
import {
  buildStockListHref,
  hasActiveStockFilters,
  type StockListQuery,
} from "@/lib/seller/stock-params";

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Buscador + pestañas de categoría del catálogo. El filtro vive en la URL
 * (igual que "Mis ventas"), así que volver atrás o compartir el enlace
 * conserva exactamente lo que estaba viendo el vendedor.
 */
export function StockToolbar({
  query,
  categories,
  brands,
}: {
  query: StockListQuery;
  /** Categorías REALES del catálogo (vienen de la base, no hay lista fija). */
  categories: string[];
  brands: string[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [searchDraft, setSearchDraft] = useState(query.search);
  // Re-sincronización durante el render (patrón de React), no en un efecto:
  // cubre "Limpiar", el botón atrás y la navegación desde otra pantalla.
  const [syncedSearch, setSyncedSearch] = useState(query.search);
  if (query.search !== syncedSearch) {
    setSyncedSearch(query.search);
    setSearchDraft(query.search);
  }

  const navigate = useCallback(
    (next: Partial<StockListQuery>) => {
      const href = buildStockListHref(ROUTES.sellerStock, { ...query, ...next });
      startTransition(() => router.push(href, { scroll: false }));
    },
    [query, router],
  );

  useEffect(() => {
    const trimmed = searchDraft.trim();
    if (trimmed === query.search) return;
    const id = setTimeout(() => navigate({ search: trimmed }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [searchDraft, query.search, navigate]);

  const filtersActive = hasActiveStockFilters(query);

  return (
    <div
      className={cn(
        "space-y-2.5 rounded-2xl border border-border bg-surface p-2.5 transition-opacity",
        isPending && "opacity-70",
      )}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="relative flex-1">
          <span className="sr-only">Buscar en el catálogo</span>
          <input
            type="search"
            inputMode="search"
            autoComplete="off"
            placeholder="Buscar por modelo o marca…"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </label>

        {brands.length > 1 && (
          <FilterSelect
            ariaLabel="Filtrar por marca"
            prefix="Marca"
            value={query.brand ?? ""}
            onValueChange={(v) => navigate({ brand: v || null })}
            options={[
              { value: "", label: "Todas" },
              ...brands.map((b) => ({ value: b, label: b })),
            ]}
            className="sm:w-auto"
          />
        )}

        {filtersActive && (
          <button
            type="button"
            onClick={() => {
              setSearchDraft("");
              setSyncedSearch("");
              startTransition(() => router.push(ROUTES.sellerStock, { scroll: false }));
            }}
            className="shrink-0 rounded-lg border border-border px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:text-foreground"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {categories.length > 0 && (
        <div
          role="tablist"
          aria-label="Categorías del catálogo"
          className="-mx-0.5 flex gap-1.5 overflow-x-auto px-0.5 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {[null, ...categories].map((c) => {
            const active = (query.category ?? null) === c;
            return (
              <button
                key={c ?? "__all__"}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => navigate({ category: c })}
                className={cn(
                  "shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] transition-colors",
                  active
                    ? "border-brand bg-brand text-brand-foreground"
                    : "border-border bg-surface-muted text-text-secondary hover:text-foreground",
                )}
              >
                {c ?? "Todas"}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
