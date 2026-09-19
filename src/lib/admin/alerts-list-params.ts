import type { AlertCategory, AlertPriority } from "@/lib/admin/alerts";

export const ALERT_CATEGORIES: AlertCategory[] = [
  "APROBACIONES", "CONTRATOS", "COBROS", "PAGOS", "COMISIONES", "LIQUIDACIONES", "VENDEDORES", "LOGISTICA",
];
export const ALERT_PRIORITIES: AlertPriority[] = ["HIGH", "MEDIUM", "LOW"];

export const ALERT_CATEGORY_OPTIONS: { value: "ALL" | AlertCategory; label: string }[] = [
  { value: "ALL", label: "Todas las categorías" },
  ...ALERT_CATEGORIES.map((c) => ({ value: c, label: c.charAt(0) + c.slice(1).toLowerCase() })),
];
export const ALERT_PRIORITY_OPTIONS: { value: "ALL" | AlertPriority; label: string }[] = [
  { value: "ALL", label: "Toda prioridad" },
  { value: "HIGH", label: "Alta" },
  { value: "MEDIUM", label: "Media" },
  { value: "LOW", label: "Baja" },
];

export const ALERTS_PAGE_SIZE = 50;

export interface AlertsListQuery {
  category: "ALL" | AlertCategory;
  priority: "ALL" | AlertPriority;
  sellerId: string | null;
  page: number;
}

const CATEGORY_VALUES = new Set<string>(ALERT_CATEGORIES);
const PRIORITY_VALUES = new Set<string>(ALERT_PRIORITIES);

type RawParams = Record<string, string | string[] | undefined>;
function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v ?? "").trim();
}

export function parseAlertsListSearchParams(raw: RawParams): AlertsListQuery {
  const categoryRaw = first(raw.category).toUpperCase();
  const priorityRaw = first(raw.priority).toUpperCase();
  const pageNum = Number.parseInt(first(raw.page), 10);
  return {
    category: CATEGORY_VALUES.has(categoryRaw) ? (categoryRaw as AlertCategory) : "ALL",
    priority: PRIORITY_VALUES.has(priorityRaw) ? (priorityRaw as AlertPriority) : "ALL",
    sellerId: first(raw.seller) || null,
    page: Number.isFinite(pageNum) && pageNum > 0 ? pageNum : 1,
  };
}

export function hasActiveAlertsFilters(q: AlertsListQuery): boolean {
  return q.category !== "ALL" || q.priority !== "ALL" || Boolean(q.sellerId);
}

export function buildAlertsListHref(base: string, q: Partial<AlertsListQuery>): string {
  const merged: AlertsListQuery = { category: "ALL", priority: "ALL", sellerId: null, page: 1, ...q };
  const sp = new URLSearchParams();
  if (merged.category !== "ALL") sp.set("category", merged.category);
  if (merged.priority !== "ALL") sp.set("priority", merged.priority);
  if (merged.sellerId) sp.set("seller", merged.sellerId);
  if (merged.page > 1) sp.set("page", String(merged.page));
  const qs = sp.toString();
  return qs ? `${base}?${qs}` : base;
}
