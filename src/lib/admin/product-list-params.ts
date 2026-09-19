/** Estado del listado de productos, en la URL — mismo principio que el resto. */
export type ProductStatusFilter = "all" | "active" | "inactive";

export const PRODUCT_STATUS_OPTIONS: { value: ProductStatusFilter; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "active", label: "Activos" },
  { value: "inactive", label: "Inactivos" },
];

export const STATUS_TO_DB: Record<ProductStatusFilter, "ALL" | "ACTIVE" | "INACTIVE"> = {
  all: "ALL",
  active: "ACTIVE",
  inactive: "INACTIVE",
};

export interface ProductListQuery {
  search: string;
  status: ProductStatusFilter;
  /** "ALL" o un valor real de `products.category` — nunca hardcodeado, se
   * puebla dinámicamente desde `admin_product_list().categories`. */
  category: string;
}

const STATUS_VALUES = new Set<ProductStatusFilter>(["all", "active", "inactive"]);

type RawParams = Record<string, string | string[] | undefined>;
function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v ?? "").trim();
}

export function parseProductListSearchParams(raw: RawParams): ProductListQuery {
  const statusRaw = first(raw.status).toLowerCase();
  return {
    search: first(raw.q).slice(0, 120),
    status: STATUS_VALUES.has(statusRaw as ProductStatusFilter) ? (statusRaw as ProductStatusFilter) : "all",
    category: first(raw.category) || "ALL",
  };
}

export function hasActiveProductFilters(q: ProductListQuery): boolean {
  return q.search !== "" || q.status !== "all" || q.category !== "ALL";
}

export function buildProductListHref(base: string, q: Partial<ProductListQuery>): string {
  const merged: ProductListQuery = { search: "", status: "all", category: "ALL", ...q };
  const sp = new URLSearchParams();
  if (merged.search) sp.set("q", merged.search);
  if (merged.status !== "all") sp.set("status", merged.status);
  if (merged.category !== "ALL") sp.set("category", merged.category);
  const qs = sp.toString();
  return qs ? `${base}?${qs}` : base;
}
