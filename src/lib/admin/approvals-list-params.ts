/** Estado del Centro de Aprobaciones, en la URL — mismo principio que el resto. */
export type ApprovalsTab = "todo" | "ediciones" | "contratos" | "cobros" | "listas";

export const APPROVALS_TABS: { value: ApprovalsTab; label: string }[] = [
  { value: "todo", label: "Todo" },
  { value: "ediciones", label: "Ediciones" },
  { value: "contratos", label: "Contratos" },
  { value: "cobros", label: "Cobros" },
  { value: "listas", label: "Listas para pagar" },
];

const TAB_VALUES = new Set<ApprovalsTab>(["todo", "ediciones", "contratos", "cobros", "listas"]);

type RawParams = Record<string, string | string[] | undefined>;
function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v ?? "").trim();
}

export function parseApprovalsTab(raw: RawParams): ApprovalsTab {
  const t = first(raw.tab).toLowerCase();
  return TAB_VALUES.has(t as ApprovalsTab) ? (t as ApprovalsTab) : "todo";
}

export function parseApprovalsSearch(raw: RawParams): string {
  return first(raw.q).slice(0, 120);
}

export function buildApprovalsTabHref(base: string, tab: ApprovalsTab): string {
  return tab === "todo" ? base : `${base}?tab=${tab}`;
}
