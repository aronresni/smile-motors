"use client";

import { FilterSelect } from "@/components/ui/filter-select";
import { useCallback, useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  FINANCING_CONTRACT_OPTIONS,
  FINANCING_STATUS_OPTIONS,
  FINANCING_TYPE_OPTIONS,
  buildFinancingListHref,
  hasActiveFinancingFilters,
  parseFinancingListSearchParams,
  type FinancingListQuery,
} from "@/lib/admin/financing-list-params";

const SEARCH_DEBOUNCE_MS = 350;

export function FinancingListToolbar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const query = parseFinancingListSearchParams(Object.fromEntries(searchParams.entries()));
  const [searchDraft, setSearchDraft] = useState(query.search);
  const [syncedSearch, setSyncedSearch] = useState(query.search);
  if (query.search !== syncedSearch) {
    setSyncedSearch(query.search);
    setSearchDraft(query.search);
  }

  const navigate = useCallback(
    (next: Partial<FinancingListQuery>) => {
      const href = buildFinancingListHref(pathname, { ...query, ...next });
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

  const filtersActive = hasActiveFinancingFilters(query);

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border p-2.5 border-border sm:flex-row sm:items-center">
      <label className="relative flex-1">
        <span className="sr-only">Buscar financiera</span>
        <input
          type="search"
          placeholder="Buscar por nombre o código…"
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-sm placeholder:text-muted-foreground border-border bg-surface text-foreground"
        />
      </label>
      <FilterSelect
        ariaLabel="Filtrar por tipo"
        prefix="Tipo"
        value={query.type}
        onValueChange={(v) => navigate({ type: v as FinancingListQuery["type"] })}
        options={FINANCING_TYPE_OPTIONS}
        containerClassName="w-full sm:w-auto"
      />
      <FilterSelect
        ariaLabel="Filtrar por estado"
        prefix="Estado"
        value={query.status}
        onValueChange={(v) => navigate({ status: v as FinancingListQuery["status"] })}
        options={FINANCING_STATUS_OPTIONS}
        containerClassName="w-full sm:w-auto"
      />
      <FilterSelect
        ariaLabel="Filtrar por contrato"
        prefix="Contrato"
        value={query.contract}
        onValueChange={(v) => navigate({ contract: v as FinancingListQuery["contract"] })}
        options={FINANCING_CONTRACT_OPTIONS}
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
