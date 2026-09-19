import type { ApprovalsTab } from "@/lib/admin/approvals-list-params";

const EDICIONES_STATUS_OPTIONS = [
  { value: "PENDING", label: "Pendientes" },
  { value: "APPROVED", label: "Aprobadas" },
  { value: "REJECTED", label: "Rechazadas" },
  { value: "ALL", label: "Todas" },
];

/** Búsqueda (y, en Ediciones, filtro de estado) server-side simple
 * (formulario GET nativo, sin JS) — conserva la pestaña activa en la URL. */
export function ApprovalsSearchBox({
  tab,
  defaultValue,
  placeholder,
  statusValue,
}: {
  tab: ApprovalsTab;
  defaultValue: string;
  placeholder: string;
  /** Solo para la pestaña "ediciones" — PENDING por defecto. */
  statusValue?: string;
}) {
  return (
    <form method="GET" className="flex flex-wrap items-center gap-2">
      {tab !== "todo" && <input type="hidden" name="tab" value={tab} />}
      <input
        type="search"
        name="q"
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="w-full max-w-sm rounded-lg border px-3 py-2 text-sm placeholder:text-muted-foreground border-border bg-surface text-foreground"
      />
      {tab === "ediciones" && (
        <select
          name="status"
          defaultValue={statusValue ?? "PENDING"}
          className="rounded-lg border px-3 py-2 text-xs font-medium border-border bg-surface text-foreground"
        >
          {EDICIONES_STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>Estado: {opt.label}</option>
          ))}
        </select>
      )}
      <button
        type="submit"
        className="shrink-0 rounded-lg border px-3 py-2 text-xs font-medium border-border text-text-secondary hover:bg-surface-elevated"
      >
        Buscar
      </button>
    </form>
  );
}
