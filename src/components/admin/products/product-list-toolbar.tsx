"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  PRODUCT_STATUS_OPTIONS,
  buildProductListHref,
  hasActiveProductFilters,
  parseProductListSearchParams,
  type ProductListQuery,
} from "@/lib/admin/product-list-params";

const SEARCH_DEBOUNCE_MS = 350;

/** El filtro de categoría se puebla con las categorías REALES ya presentes
 * en `products` (pasadas desde el servidor) — nunca una lista fija de
 * "Motos gasolina/eléctricas/..." hardcodeada. */
export function ProductListToolbar({ categories }: { categories: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const query = parseProductListSearchParams(Object.fromEntries(searchParams.entries()));
  const [searchDraft, setSearchDraft] = useState(query.search);
  const [syncedSearch, setSyncedSearch] = useState(query.search);
  if (query.search !== syncedSearch) {
    setSyncedSearch(query.search);
    setSearchDraft(query.search);
  }

  const navigate = useCallback(
    (next: Partial<ProductListQuery>) => {
      const href = buildProductListHref(pathname, { ...query, ...next });
      startTransition(() => router.push(href, { scroll: false }));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pathname, router, searchParams],
  );

  useEffect(() => {
    const trimmed = searchDraft.trim();
    if (trimmed === query.search) return;
    const id = setTimeout(() => navigate({ search: trimmed }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft]);

  const filtersActive = hasActiveProductFilters(query);

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border p-2.5 border-border sm:flex-row sm:items-center">
      <label className="relative flex-1">
        <span className="sr-only">Buscar producto</span>
        <input
          type="search"
          placeholder="Buscar por nombre, marca, modelo o ID legado…"
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-sm placeholder:text-muted-foreground border-border bg-surface text-foreground"
        />
      </label>
      <select
        aria-label="Filtrar por estado"
        value={query.status}
        onChange={(e) => navigate({ status: e.target.value as ProductListQuery["status"] })}
        className="rounded-lg border px-3 py-2 text-xs font-medium border-border bg-surface text-foreground"
      >
        {PRODUCT_STATUS_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>Estado: {opt.label}</option>
        ))}
      </select>
      <select
        aria-label="Filtrar por categoría"
        value={query.category}
        onChange={(e) => navigate({ category: e.target.value })}
        className="rounded-lg border px-3 py-2 text-xs font-medium border-border bg-surface text-foreground"
      >
        <option value="ALL">Categoría: Todas</option>
        {categories.map((c) => (
          <option key={c} value={c}>Categoría: {c}</option>
        ))}
      </select>
      {filtersActive && (
        <button
          type="button"
          onClick={() => startTransition(() => router.push(pathname, { scroll: false }))}
          className="shrink-0 rounded-lg border px-3 py-2 text-xs font-medium text-muted-foreground border-border hover:text-foreground"
        >
          Limpiar filtros
        </button>
      )}
    </div>
  );
}
