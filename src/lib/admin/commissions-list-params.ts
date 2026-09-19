/** Estado del listado de comisiones, en la URL — mismo principio que el resto. */
export type CommissionStatusFilter = "all" | "pending" | "eligible";

export const COMMISSION_STATUS_OPTIONS: { value: CommissionStatusFilter; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "pending", label: "Pendiente" },
  { value: "eligible", label: "Elegible" },
];

export const STATUS_TO_DB: Record<CommissionStatusFilter, "ALL" | "PENDING" | "ELIGIBLE"> = {
  all: "ALL",
  pending: "PENDING",
  eligible: "ELIGIBLE",
};

export const COMMISSION_LIST_PAGE_SIZE = 30;

export interface CommissionListQuery {
  search: string;
  status: CommissionStatusFilter;
  sellerId: string | null;
  page: number;
}

const STATUS_VALUES = new Set<CommissionStatusFilter>(["all", "pending", "eligible"]);

type RawParams = Record<string, string | string[] | undefined>;
function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v ?? "").trim();
}

export function parseCommissionListSearchParams(raw: RawParams): CommissionListQuery {
  const statusRaw = first(raw.status).toLowerCase();
  const pageNum = Number.parseInt(first(raw.page), 10);
  return {
    search: first(raw.q).slice(0, 120),
    status: STATUS_VALUES.has(statusRaw as CommissionStatusFilter) ? (statusRaw as CommissionStatusFilter) : "all",
    sellerId: first(raw.seller) || null,
    page: Number.isFinite(pageNum) && pageNum > 0 ? pageNum : 1,
  };
}

export function hasActiveCommissionFilters(q: CommissionListQuery): boolean {
  return q.search !== "" || q.status !== "all" || Boolean(q.sellerId);
}

export function buildCommissionListHref(base: string, q: Partial<CommissionListQuery>): string {
  const merged: CommissionListQuery = { search: "", status: "all", sellerId: null, page: 1, ...q };
  const sp = new URLSearchParams();
  if (merged.search) sp.set("q", merged.search);
  if (merged.status !== "all") sp.set("status", merged.status);
  if (merged.sellerId) sp.set("seller", merged.sellerId);
  if (merged.page > 1) sp.set("page", String(merged.page));
  const qs = sp.toString();
  return qs ? `${base}?${qs}` : base;
}
