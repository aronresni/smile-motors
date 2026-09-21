import type { ActivityCategory } from "@/lib/admin/activity";

export const ACTIVITY_CATEGORIES: ActivityCategory[] = [
  "VENTAS", "CONTRATOS", "COBROS", "PRODUCTOS", "COMISIONES", "LIQUIDACIONES", "VENDEDORES", "LOGISTICA",
];

export const ACTIVITY_CATEGORY_OPTIONS: { value: "ALL" | ActivityCategory; label: string }[] = [
  { value: "ALL", label: "Todas las categorías" },
  ...ACTIVITY_CATEGORIES.map((c) => ({ value: c, label: c.charAt(0) + c.slice(1).toLowerCase() })),
];

export const ACTIVITY_PAGE_SIZE = 50;

export interface ActivityListQuery {
  category: "ALL" | ActivityCategory;
  /** Quién HIZO la acción (no confundir con el vendedor de la venta). */
  actorId: string | null;
  sellerId: string | null;
  search: string;
  startDate: string | null;
  endDate: string | null;
  page: number;
}

const CATEGORY_VALUES = new Set<string>(ACTIVITY_CATEGORIES);

type RawParams = Record<string, string | string[] | undefined>;
function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v ?? "").trim();
}
function isIsoDate(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}

export function parseActivityListSearchParams(raw: RawParams): ActivityListQuery {
  const categoryRaw = first(raw.category).toUpperCase();
  const pageNum = Number.parseInt(first(raw.page), 10);
  const start = first(raw.start);
  const end = first(raw.end);
  return {
    category: CATEGORY_VALUES.has(categoryRaw) ? (categoryRaw as ActivityCategory) : "ALL",
    actorId: first(raw.actor) || null,
    sellerId: first(raw.seller) || null,
    search: first(raw.q).slice(0, 120),
    startDate: isIsoDate(start) ? start : null,
    endDate: isIsoDate(end) ? end : null,
    page: Number.isFinite(pageNum) && pageNum > 0 ? pageNum : 1,
  };
}

export function hasActiveActivityFilters(q: ActivityListQuery): boolean {
  return q.category !== "ALL" || Boolean(q.actorId) || Boolean(q.sellerId) || q.search !== "" || Boolean(q.startDate) || Boolean(q.endDate);
}

export function buildActivityListHref(base: string, q: Partial<ActivityListQuery>): string {
  const merged: ActivityListQuery = {
    category: "ALL", actorId: null, sellerId: null, search: "", startDate: null, endDate: null, page: 1, ...q,
  };
  const sp = new URLSearchParams();
  if (merged.category !== "ALL") sp.set("category", merged.category);
  if (merged.actorId) sp.set("actor", merged.actorId);
  if (merged.sellerId) sp.set("seller", merged.sellerId);
  if (merged.search) sp.set("q", merged.search);
  if (merged.startDate) sp.set("start", merged.startDate);
  if (merged.endDate) sp.set("end", merged.endDate);
  if (merged.page > 1) sp.set("page", String(merged.page));
  const qs = sp.toString();
  return qs ? `${base}?${qs}` : base;
}
