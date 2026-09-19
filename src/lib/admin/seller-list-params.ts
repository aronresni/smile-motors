/** Estado del listado de vendedores, en la URL — mismo principio que el resto. */
export type SellerStatusFilter = "all" | "active" | "invited" | "suspended" | "disabled";

export const SELLER_STATUS_OPTIONS: { value: SellerStatusFilter; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "active", label: "Activos" },
  { value: "invited", label: "Invitados" },
  { value: "suspended", label: "Suspendidos" },
  { value: "disabled", label: "Deshabilitados" },
];

export interface SellerListQuery {
  search: string;
  status: SellerStatusFilter;
  page: number;
}

const STATUS_VALUES = new Set<SellerStatusFilter>(["all", "active", "invited", "suspended", "disabled"]);
export const STATUS_TO_DB: Record<SellerStatusFilter, "ALL" | "ACTIVE" | "INVITED" | "SUSPENDED" | "DISABLED"> = {
  all: "ALL",
  active: "ACTIVE",
  invited: "INVITED",
  suspended: "SUSPENDED",
  disabled: "DISABLED",
};

type RawParams = Record<string, string | string[] | undefined>;
function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v ?? "").trim();
}

export function parseSellerListSearchParams(raw: RawParams): SellerListQuery {
  const statusRaw = first(raw.status).toLowerCase();
  const status = STATUS_VALUES.has(statusRaw as SellerStatusFilter) ? (statusRaw as SellerStatusFilter) : "all";
  const pageNum = Number.parseInt(first(raw.page), 10);
  const page = Number.isFinite(pageNum) && pageNum > 0 ? pageNum : 1;
  const search = first(raw.q).slice(0, 120);
  return { search, status, page };
}

export function hasActiveSellerFilters(q: SellerListQuery): boolean {
  return q.search !== "" || q.status !== "all";
}

export function buildSellerListHref(base: string, q: Partial<SellerListQuery>): string {
  const merged: SellerListQuery = { search: "", status: "all", page: 1, ...q };
  const sp = new URLSearchParams();
  if (merged.search) sp.set("q", merged.search);
  if (merged.status !== "all") sp.set("status", merged.status);
  if (merged.page > 1) sp.set("page", String(merged.page));
  const qs = sp.toString();
  return qs ? `${base}?${qs}` : base;
}
