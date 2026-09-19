"use client";

import { FilterSelect } from "@/components/ui/filter-select";
import { useCallback, useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  SELLER_STATUS_OPTIONS,
  buildSellerListHref,
  hasActiveSellerFilters,
  parseSellerListSearchParams,
  type SellerListQuery,
} from "@/lib/admin/seller-list-params";

const SEARCH_DEBOUNCE_MS = 350;

export function SellerListToolbar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const query = parseSellerListSearchParams(Object.fromEntries(searchParams.entries()));
  const [searchDraft, setSearchDraft] = useState(query.search);
  const [syncedSearch, setSyncedSearch] = useState(query.search);
  if (query.search !== syncedSearch) {
    setSyncedSearch(query.search);
    setSearchDraft(query.search);
  }

  const navigate = useCallback(
    (next: Partial<SellerListQuery>) => {
      const href = buildSellerListHref(pathname, { ...query, page: 1, ...next });
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

  const filtersActive = hasActiveSellerFilters(query);

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border p-2.5 border-border sm:flex-row sm:items-center">
      <label className="relative flex-1">
        <span className="sr-only">Buscar vendedor</span>
        <input
          type="search"
          placeholder="Buscar por nombre, correo o teléfono…"
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-sm placeholder:text-muted-foreground border-border bg-surface text-foreground"
        />
      </label>
      <FilterSelect
        ariaLabel="Filtrar por estado"
        prefix="Estado"
        value={query.status}
        onValueChange={(v) => navigate({ status: v as SellerListQuery["status"] })}
        options={SELLER_STATUS_OPTIONS}
        containerClassName="w-full sm:w-auto"
      />
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
