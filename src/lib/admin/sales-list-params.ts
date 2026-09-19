/**
 * Estado del listado de ventas de administración, expresado en la URL —
 * mismo principio que `@/lib/seller/sales-list-params`: la verdad vive en la
 * query string, nunca solo en estado de React. Módulo puro (sin
 * `server-only`): lo usa tanto la página de servidor como la barra de
 * herramientas de cliente.
 */
import {
  resolveRange,
  todayISO,
  type PeriodKind,
} from "@/lib/seller/period";

export const ADMIN_SALES_LIST_PAGE_SIZE = 20;

export type AdminSaleStatusFilter = "all" | "draft" | "pending" | "sold" | "paid";
export type AdminCollectionFilter =
  | "all"
  | "pending_collection"
  | "ready_to_pay"
  | "paid";
export type AdminFinancingFilter =
  | "all"
  | "unsigned"
  | "signed"
  | "pending_accreditation"
  | "accredited";
export type AdminPeriodFilter = "all" | "today" | "week" | "month" | "year" | "custom";

export interface AdminSalesListOption<T extends string> {
  value: T;
  label: string;
}

export const ADMIN_SALE_STATUS_OPTIONS: AdminSalesListOption<AdminSaleStatusFilter>[] = [
  { value: "all", label: "Todos (sin borradores)" },
  { value: "draft", label: "Borrador" },
  { value: "pending", label: "Pendiente" },
  { value: "sold", label: "Vendida" },
  { value: "paid", label: "Pagada" },
];

export const ADMIN_COLLECTION_OPTIONS: AdminSalesListOption<AdminCollectionFilter>[] = [
  { value: "all", label: "Todos" },
  { value: "pending_collection", label: "Pendiente a cobrar" },
  { value: "ready_to_pay", label: "Listo para pagar" },
  { value: "paid", label: "Pagado" },
];

export const ADMIN_FINANCING_OPTIONS: AdminSalesListOption<AdminFinancingFilter>[] = [
  { value: "all", label: "Todos" },
  { value: "unsigned", label: "Contratos sin firmar" },
  { value: "signed", label: "Firmados" },
  { value: "pending_accreditation", label: "Pendiente de acreditar" },
  { value: "accredited", label: "Totalmente acreditados" },
];

export const ADMIN_PERIOD_OPTIONS: AdminSalesListOption<
  Exclude<AdminPeriodFilter, "custom">
>[] = [
  { value: "all", label: "Todos" },
  { value: "today", label: "Hoy" },
  { value: "week", label: "Esta semana" },
  { value: "month", label: "Este mes" },
  { value: "year", label: "Este año" },
];

export interface AdminSalesListQuery {
  search: string;
  saleStatus: AdminSaleStatusFilter;
  collection: AdminCollectionFilter;
  financing: AdminFinancingFilter;
  sellerId: string | null;
  period: AdminPeriodFilter;
  from: string | null;
  to: string | null;
  page: number;
}

export const DEFAULT_ADMIN_SALES_LIST_QUERY: AdminSalesListQuery = {
  search: "",
  saleStatus: "all",
  collection: "all",
  financing: "all",
  sellerId: null,
  period: "all",
  from: null,
  to: null,
  page: 1,
};

const SALE_STATUS_VALUES = new Set<AdminSaleStatusFilter>(["all", "draft", "pending", "sold", "paid"]);
const COLLECTION_VALUES = new Set<AdminCollectionFilter>([
  "all",
  "pending_collection",
  "ready_to_pay",
  "paid",
]);
const FINANCING_VALUES = new Set<AdminFinancingFilter>([
  "all",
  "unsigned",
  "signed",
  "pending_accreditation",
  "accredited",
]);
const PERIOD_VALUES = new Set<AdminPeriodFilter>(["all", "today", "week", "month", "year", "custom"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type RawParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v ?? "").trim();
}

export function parseAdminSalesListSearchParams(raw: RawParams): AdminSalesListQuery {
  const saleStatusRaw = first(raw.status).toLowerCase();
  const collectionRaw = first(raw.collection).toLowerCase();
  const financingRaw = first(raw.financing).toLowerCase();
  const periodRaw = first(raw.period).toLowerCase();
  const fromRaw = first(raw.from);
  const toRaw = first(raw.to);
  const sellerIdRaw = first(raw.seller);

  const saleStatus = SALE_STATUS_VALUES.has(saleStatusRaw as AdminSaleStatusFilter)
    ? (saleStatusRaw as AdminSaleStatusFilter)
    : "all";
  const collection = COLLECTION_VALUES.has(collectionRaw as AdminCollectionFilter)
    ? (collectionRaw as AdminCollectionFilter)
    : "all";
  const financing = FINANCING_VALUES.has(financingRaw as AdminFinancingFilter)
    ? (financingRaw as AdminFinancingFilter)
    : "all";
  let period = PERIOD_VALUES.has(periodRaw as AdminPeriodFilter)
    ? (periodRaw as AdminPeriodFilter)
    : "all";

  const from = ISO_DATE.test(fromRaw) ? fromRaw : null;
  const to = ISO_DATE.test(toRaw) ? toRaw : null;
  if (period === "custom" && !(from && to)) period = "all";

  const pageNum = Number.parseInt(first(raw.page), 10);
  const page = Number.isFinite(pageNum) && pageNum > 0 ? pageNum : 1;
  const search = first(raw.q).slice(0, 120);

  return {
    search,
    saleStatus,
    collection,
    financing,
    sellerId: sellerIdRaw || null,
    period,
    from: period === "custom" ? from : null,
    to: period === "custom" ? to : null,
    page,
  };
}

export function hasActiveAdminSalesListFilters(q: AdminSalesListQuery): boolean {
  return (
    q.search !== "" ||
    q.saleStatus !== "all" ||
    q.collection !== "all" ||
    q.financing !== "all" ||
    Boolean(q.sellerId) ||
    q.period !== "all"
  );
}

export function resolveAdminSalesListDateRange(
  q: AdminSalesListQuery,
  reference: Date = new Date(),
): { startDate: string | null; endDate: string | null } {
  if (q.period === "all") return { startDate: null, endDate: null };
  if (q.period === "custom") return { startDate: q.from, endDate: q.to };
  const kind: PeriodKind =
    q.period === "today" ? "day" : q.period === "week" ? "week" : q.period === "month" ? "month" : "year";
  const range = resolveRange({ kind, anchor: todayISO(reference) });
  return { startDate: range.startISO, endDate: range.endISO };
}

export function buildAdminSalesListHref(
  base: string,
  q: Partial<AdminSalesListQuery>,
): string {
  const merged: AdminSalesListQuery = { ...DEFAULT_ADMIN_SALES_LIST_QUERY, ...q };
  const sp = new URLSearchParams();
  if (merged.search) sp.set("q", merged.search);
  if (merged.saleStatus !== "all") sp.set("status", merged.saleStatus);
  if (merged.collection !== "all") sp.set("collection", merged.collection);
  if (merged.financing !== "all") sp.set("financing", merged.financing);
  if (merged.sellerId) sp.set("seller", merged.sellerId);
  if (merged.period !== "all") sp.set("period", merged.period);
  if (merged.period === "custom") {
    if (merged.from) sp.set("from", merged.from);
    if (merged.to) sp.set("to", merged.to);
  }
  if (merged.page > 1) sp.set("page", String(merged.page));
  const qs = sp.toString();
  return qs ? `${base}?${qs}` : base;
}
