/**
 * Estado de la lista "Mis ventas" expresado como parámetros de URL.
 *
 * Módulo puro (sin `server-only`): lo usan tanto la página de servidor para
 * leer los filtros como la barra de herramientas de cliente para construir los
 * enlaces. La verdad del estado vive SIEMPRE en la query string, nunca solo en
 * estado local de React.
 */

import {
  resolveRange,
  todayISO,
  type PeriodKind,
} from "@/lib/seller/period";

export const SALES_LIST_PAGE_SIZE = 20;

export type SalesListStatusFilter =
  | "all"
  | "draft"
  | "pending"
  | "sold"
  | "paid"
  | "cancelled";
export type SalesListOperationFilter = "all" | "cuba" | "usa" | "local";
export type SalesListFinancingFilter =
  | "all"
  | "none"
  | "pending_contract"
  | "sent"
  | "signed"
  | "accredited";
/** Estado de COBRO, separado del estado comercial (`status`). */
export type SalesListSettlementFilter = "all" | "pending_collection" | "paid";
export type SalesListPeriodFilter =
  | "all"
  | "today"
  | "week"
  | "month"
  | "year"
  | "custom";

export interface SalesListOption<T extends string> {
  value: T;
  label: string;
}

export const SALES_LIST_STATUS_OPTIONS: SalesListOption<SalesListStatusFilter>[] =
  [
    { value: "all", label: "Todos" },
    { value: "draft", label: "Borrador" },
    { value: "pending", label: "Pendiente" },
    { value: "sold", label: "Vendida" },
    { value: "paid", label: "Pagada" },
    { value: "cancelled", label: "Cancelada" },
  ];

export const SALES_LIST_OPERATION_OPTIONS: SalesListOption<SalesListOperationFilter>[] =
  [
    { value: "all", label: "Todas" },
    { value: "cuba", label: "Cuba" },
    { value: "usa", label: "USA" },
    { value: "local", label: "Local" },
  ];

export const SALES_LIST_FINANCING_OPTIONS: SalesListOption<SalesListFinancingFilter>[] =
  [
    { value: "all", label: "Todos" },
    { value: "none", label: "Sin financiera" },
    { value: "pending_contract", label: "Contrato pendiente" },
    { value: "sent", label: "Enviado" },
    { value: "signed", label: "Firmado" },
    { value: "accredited", label: "Acreditado" },
  ];

/** Solo tiene efecto sobre ventas VENDIDA/PAGADA (el resto no tiene cobro). */
export const SALES_LIST_SETTLEMENT_OPTIONS: SalesListOption<SalesListSettlementFilter>[] =
  [
    { value: "all", label: "Todos" },
    { value: "pending_collection", label: "Pendiente a cobrar" },
    { value: "paid", label: "Pagado" },
  ];

/** Opciones visibles en la UI (el valor `custom` existe pero no se ofrece). */
export const SALES_LIST_PERIOD_OPTIONS: SalesListOption<
  Exclude<SalesListPeriodFilter, "custom">
>[] = [
  { value: "all", label: "Todos" },
  { value: "today", label: "Hoy" },
  { value: "week", label: "Esta semana" },
  { value: "month", label: "Este mes" },
  { value: "year", label: "Este año" },
];

/** Estado normalizado de la lista. Deriva 1:1 de la query string. */
export interface SellerSalesListQuery {
  search: string;
  status: SalesListStatusFilter;
  operation: SalesListOperationFilter;
  financing: SalesListFinancingFilter;
  settlement: SalesListSettlementFilter;
  period: SalesListPeriodFilter;
  /** Solo con `period === "custom"`: rango explícito `yyyy-mm-dd`. */
  from: string | null;
  to: string | null;
  page: number;
}

export const DEFAULT_SALES_LIST_QUERY: SellerSalesListQuery = {
  search: "",
  status: "all",
  operation: "all",
  financing: "all",
  settlement: "all",
  period: "all",
  from: null,
  to: null,
  page: 1,
};

const STATUS_VALUES = new Set<SalesListStatusFilter>([
  "all",
  "draft",
  "pending",
  "sold",
  "paid",
  "cancelled",
]);
const OPERATION_VALUES = new Set<SalesListOperationFilter>([
  "all",
  "cuba",
  "usa",
  "local",
]);
const FINANCING_VALUES = new Set<SalesListFinancingFilter>([
  "all",
  "none",
  "pending_contract",
  "sent",
  "signed",
  "accredited",
]);
const SETTLEMENT_VALUES = new Set<SalesListSettlementFilter>([
  "all",
  "pending_collection",
  "paid",
]);
const PERIOD_VALUES = new Set<SalesListPeriodFilter>([
  "all",
  "today",
  "week",
  "month",
  "year",
  "custom",
]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type RawParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v ?? "").trim();
}

/** Lee la query string cruda de la página y devuelve el estado normalizado. */
export function parseSalesListSearchParams(raw: RawParams): SellerSalesListQuery {
  const statusRaw = first(raw.status).toLowerCase();
  const operationRaw = first(raw.operation).toLowerCase();
  const financingRaw = first(raw.financing).toLowerCase();
  const settlementRaw = first(raw.settlement).toLowerCase();
  const periodRaw = first(raw.period).toLowerCase();
  const fromRaw = first(raw.from);
  const toRaw = first(raw.to);

  const status = STATUS_VALUES.has(statusRaw as SalesListStatusFilter)
    ? (statusRaw as SalesListStatusFilter)
    : "all";
  const operation = OPERATION_VALUES.has(
    operationRaw as SalesListOperationFilter,
  )
    ? (operationRaw as SalesListOperationFilter)
    : "all";
  const financing = FINANCING_VALUES.has(
    financingRaw as SalesListFinancingFilter,
  )
    ? (financingRaw as SalesListFinancingFilter)
    : "all";
  const settlement = SETTLEMENT_VALUES.has(
    settlementRaw as SalesListSettlementFilter,
  )
    ? (settlementRaw as SalesListSettlementFilter)
    : "all";
  let period = PERIOD_VALUES.has(periodRaw as SalesListPeriodFilter)
    ? (periodRaw as SalesListPeriodFilter)
    : "all";

  const from = ISO_DATE.test(fromRaw) ? fromRaw : null;
  const to = ISO_DATE.test(toRaw) ? toRaw : null;
  // `custom` solo es válido con ambos extremos; si no, se degrada a "all".
  if (period === "custom" && !(from && to)) period = "all";

  const pageNum = Number.parseInt(first(raw.page), 10);
  const page = Number.isFinite(pageNum) && pageNum > 0 ? pageNum : 1;

  const search = first(raw.q).slice(0, 120);

  return {
    search,
    status,
    operation,
    financing,
    settlement,
    period,
    from: period === "custom" ? from : null,
    to: period === "custom" ? to : null,
    page,
  };
}

/** ¿El estado actual es el de por defecto (sin filtros ni búsqueda)? */
export function isDefaultSalesListQuery(q: SellerSalesListQuery): boolean {
  return (
    q.search === "" &&
    q.status === "all" &&
    q.operation === "all" &&
    q.financing === "all" &&
    q.settlement === "all" &&
    q.period === "all" &&
    q.page === 1
  );
}

/** ¿Hay algún filtro/búsqueda activo (ignorando la paginación)? */
export function hasActiveSalesListFilters(q: SellerSalesListQuery): boolean {
  return (
    q.search !== "" ||
    q.status !== "all" ||
    q.operation !== "all" ||
    q.financing !== "all" ||
    q.settlement !== "all" ||
    q.period !== "all"
  );
}

/**
 * Rango de fechas efectivo del filtro de período (`yyyy-mm-dd` inclusive) o
 * `null` cuando el período es "todos". El cálculo reutiliza el motor de
 * períodos del panel para ser coherente con el resto del área.
 */
export function resolveSalesListDateRange(
  q: SellerSalesListQuery,
  reference: Date = new Date(),
): { startDate: string | null; endDate: string | null } {
  if (q.period === "all") return { startDate: null, endDate: null };
  if (q.period === "custom") {
    return { startDate: q.from, endDate: q.to };
  }
  const kind: PeriodKind =
    q.period === "today"
      ? "day"
      : q.period === "week"
        ? "week"
        : q.period === "month"
          ? "month"
          : "year";
  const range = resolveRange({ kind, anchor: todayISO(reference) });
  return { startDate: range.startISO, endDate: range.endISO };
}

/**
 * Construye el `href` de la lista con el estado dado. Omite los valores por
 * defecto para dejar URLs limpias y compartibles.
 */
export function buildSalesListHref(
  base: string,
  q: Partial<SellerSalesListQuery>,
): string {
  const merged: SellerSalesListQuery = { ...DEFAULT_SALES_LIST_QUERY, ...q };
  const sp = new URLSearchParams();
  if (merged.search) sp.set("q", merged.search);
  if (merged.status !== "all") sp.set("status", merged.status);
  if (merged.operation !== "all") sp.set("operation", merged.operation);
  if (merged.financing !== "all") sp.set("financing", merged.financing);
  if (merged.settlement !== "all") sp.set("settlement", merged.settlement);
  if (merged.period !== "all") sp.set("period", merged.period);
  if (merged.period === "custom") {
    if (merged.from) sp.set("from", merged.from);
    if (merged.to) sp.set("to", merged.to);
  }
  if (merged.page > 1) sp.set("page", String(merged.page));
  const qs = sp.toString();
  return qs ? `${base}?${qs}` : base;
}
