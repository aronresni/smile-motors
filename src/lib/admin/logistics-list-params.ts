import { LOGISTICS_STATUS_OPTIONS, type LogisticsStatus } from "@/lib/admin/logistics";

export const LOGISTICS_LIST_PAGE_SIZE = 50;

export const LOGISTICS_STATUS_FILTER_OPTIONS: { value: "ALL" | LogisticsStatus; label: string }[] = [
  { value: "ALL", label: "Todos los estados" },
  ...LOGISTICS_STATUS_OPTIONS,
];

export const COMMERCIAL_STATUS_OPTIONS: { value: "ALL" | "PENDING" | "SOLD" | "PAID"; label: string }[] = [
  { value: "ALL", label: "Cualquier estado de venta" },
  { value: "PENDING", label: "Pending" },
  { value: "SOLD", label: "Sold" },
  { value: "PAID", label: "Paid" },
];

export interface LogisticsListQuery {
  status: "ALL" | LogisticsStatus;
  commercialStatus: "ALL" | "PENDING" | "SOLD" | "PAID";
  sellerId: string | null;
  search: string;
  page: number;
}

const STATUS_VALUES = new Set(LOGISTICS_STATUS_OPTIONS.map((o) => o.value));
const COMMERCIAL_VALUES = new Set(["PENDING", "SOLD", "PAID"]);

type RawParams = Record<string, string | string[] | undefined>;
function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v ?? "").trim();
}

export function parseLogisticsListSearchParams(raw: RawParams): LogisticsListQuery {
  const statusRaw = first(raw.status).toUpperCase();
  const commercialRaw = first(raw.commercial).toUpperCase();
  const pageNum = Number.parseInt(first(raw.page), 10);
  return {
    status: STATUS_VALUES.has(statusRaw as LogisticsStatus) ? (statusRaw as LogisticsStatus) : "ALL",
    commercialStatus: COMMERCIAL_VALUES.has(commercialRaw) ? (commercialRaw as "PENDING" | "SOLD" | "PAID") : "ALL",
    sellerId: first(raw.seller) || null,
    search: first(raw.q).slice(0, 120),
    page: Number.isFinite(pageNum) && pageNum > 0 ? pageNum : 1,
  };
}

export function hasActiveLogisticsFilters(q: LogisticsListQuery): boolean {
  return q.status !== "ALL" || q.commercialStatus !== "ALL" || Boolean(q.sellerId) || q.search !== "";
}

export function buildLogisticsListHref(base: string, q: Partial<LogisticsListQuery>): string {
  const merged: LogisticsListQuery = { status: "ALL", commercialStatus: "ALL", sellerId: null, search: "", page: 1, ...q };
  const sp = new URLSearchParams();
  if (merged.status !== "ALL") sp.set("status", merged.status);
  if (merged.commercialStatus !== "ALL") sp.set("commercial", merged.commercialStatus);
  if (merged.sellerId) sp.set("seller", merged.sellerId);
  if (merged.search) sp.set("q", merged.search);
  if (merged.page > 1) sp.set("page", String(merged.page));
  const qs = sp.toString();
  return qs ? `${base}?${qs}` : base;
}
