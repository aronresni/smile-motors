/** Estado del listado de financieras, en la URL — mismo principio que el resto. */
export type FinancingTypeFilter = "all" | "financing" | "direct";
export type FinancingStatusFilter = "all" | "active" | "inactive";
export type FinancingContractFilter = "all" | "required" | "not_required";

export const FINANCING_TYPE_OPTIONS: { value: FinancingTypeFilter; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "financing", label: "Financiación" },
  { value: "direct", label: "Pago directo" },
];
export const FINANCING_STATUS_OPTIONS: { value: FinancingStatusFilter; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "active", label: "Activos" },
  { value: "inactive", label: "Inactivos" },
];
export const FINANCING_CONTRACT_OPTIONS: { value: FinancingContractFilter; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "required", label: "Requiere contrato" },
  { value: "not_required", label: "Sin contrato" },
];

/** El filtro de tipo mezcla varios `method_type` — "Pago directo" cubre
 * CARD/ZELLE/INTERNAL, solo "Financiación" es un valor de columna directo. */
export const TYPE_TO_DB: Record<FinancingTypeFilter, "ALL" | "FINANCING" | "DIRECT"> = {
  all: "ALL",
  financing: "FINANCING",
  direct: "DIRECT",
};
export const STATUS_TO_DB: Record<FinancingStatusFilter, "ALL" | "ACTIVE" | "INACTIVE"> = {
  all: "ALL",
  active: "ACTIVE",
  inactive: "INACTIVE",
};
export const CONTRACT_TO_DB: Record<FinancingContractFilter, "ALL" | "REQUIRED" | "NOT_REQUIRED"> = {
  all: "ALL",
  required: "REQUIRED",
  not_required: "NOT_REQUIRED",
};

export interface FinancingListQuery {
  search: string;
  type: FinancingTypeFilter;
  status: FinancingStatusFilter;
  contract: FinancingContractFilter;
}

const TYPE_VALUES = new Set<FinancingTypeFilter>(["all", "financing", "direct"]);
const STATUS_VALUES = new Set<FinancingStatusFilter>(["all", "active", "inactive"]);
const CONTRACT_VALUES = new Set<FinancingContractFilter>(["all", "required", "not_required"]);

type RawParams = Record<string, string | string[] | undefined>;
function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v ?? "").trim();
}

export function parseFinancingListSearchParams(raw: RawParams): FinancingListQuery {
  const typeRaw = first(raw.type).toLowerCase();
  const statusRaw = first(raw.status).toLowerCase();
  const contractRaw = first(raw.contract).toLowerCase();
  return {
    search: first(raw.q).slice(0, 120),
    type: TYPE_VALUES.has(typeRaw as FinancingTypeFilter) ? (typeRaw as FinancingTypeFilter) : "all",
    status: STATUS_VALUES.has(statusRaw as FinancingStatusFilter) ? (statusRaw as FinancingStatusFilter) : "all",
    contract: CONTRACT_VALUES.has(contractRaw as FinancingContractFilter)
      ? (contractRaw as FinancingContractFilter)
      : "all",
  };
}

export function hasActiveFinancingFilters(q: FinancingListQuery): boolean {
  return q.search !== "" || q.type !== "all" || q.status !== "all" || q.contract !== "all";
}

export function buildFinancingListHref(base: string, q: Partial<FinancingListQuery>): string {
  const merged: FinancingListQuery = { search: "", type: "all", status: "all", contract: "all", ...q };
  const sp = new URLSearchParams();
  if (merged.search) sp.set("q", merged.search);
  if (merged.type !== "all") sp.set("type", merged.type);
  if (merged.status !== "all") sp.set("status", merged.status);
  if (merged.contract !== "all") sp.set("contract", merged.contract);
  const qs = sp.toString();
  return qs ? `${base}?${qs}` : base;
}
