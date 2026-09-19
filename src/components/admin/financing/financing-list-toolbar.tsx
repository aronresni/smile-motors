"use client";

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
      <select
        aria-label="Filtrar por tipo"
        value={query.type}
        onChange={(e) => navigate({ type: e.target.value as FinancingListQuery["type"] })}
        className="rounded-lg border px-3 py-2 text-xs font-medium border-border bg-surface text-foreground"
      >
        {FINANCING_TYPE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>Tipo: {opt.label}</option>
        ))}
      </select>
      <select
        aria-label="Filtrar por estado"
        value={query.status}
        onChange={(e) => navigate({ status: e.target.value as FinancingListQuery["status"] })}
        className="rounded-lg border px-3 py-2 text-xs font-medium border-border bg-surface text-foreground"
      >
        {FINANCING_STATUS_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>Estado: {opt.label}</option>
        ))}
      </select>
      <select
        aria-label="Filtrar por contrato"
        value={query.contract}
        onChange={(e) => navigate({ contract: e.target.value as FinancingListQuery["contract"] })}
        className="rounded-lg border px-3 py-2 text-xs font-medium border-border bg-surface text-foreground"
      >
        {FINANCING_CONTRACT_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>Contrato: {opt.label}</option>
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
