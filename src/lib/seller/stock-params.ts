/**
 * Parámetros de la lista del catálogo del vendedor (/seller/stock).
 * Módulo PURO (cliente + servidor): el filtro vive en la URL, así que la
 * pantalla se puede compartir, recargar y volver atrás sin perder el estado.
 */

export interface StockListQuery {
  search: string;
  /** Categoría EXACTA tal como está en la base ("250CC", "ELECTRIC"…). */
  category: string | null;
  brand: string | null;
}

type RawParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : (v ?? "")).trim();
}

export function parseStockListSearchParams(raw: RawParams): StockListQuery {
  return {
    search: first(raw.q).slice(0, 80),
    category: first(raw.categoria) || null,
    brand: first(raw.marca) || null,
  };
}

export function hasActiveStockFilters(q: StockListQuery): boolean {
  return q.search !== "" || Boolean(q.category) || Boolean(q.brand);
}

export function buildStockListHref(base: string, q: Partial<StockListQuery>): string {
  const merged: StockListQuery = { search: "", category: null, brand: null, ...q };
  const sp = new URLSearchParams();
  if (merged.search) sp.set("q", merged.search);
  if (merged.category) sp.set("categoria", merged.category);
  if (merged.brand) sp.set("marca", merged.brand);
  const qs = sp.toString();
  return qs ? `${base}?${qs}` : base;
}
