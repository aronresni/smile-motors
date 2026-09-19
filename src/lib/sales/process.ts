import type { StatusHistoryEntry } from "@/lib/sales/confirmed-sale";

/**
 * Pasos del proceso comercial (compartido Vendedor ↔ Admin, sin server-only):
 * BORRADOR → PENDIENTE → VENDIDA → PAGADA, con la fecha de la ÚLTIMA entrada
 * a cada estado según `sale_status_history`.
 */
const STEPS = [
  { key: "DRAFT", label: "Borrador" },
  { key: "PENDING", label: "Pendiente" },
  { key: "SOLD", label: "Vendida" },
  { key: "PAID", label: "Pagada" },
];

function when(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("es-DO", { day: "numeric", month: "short" }).format(d);
}

export function commercialSteps(
  history: StatusHistoryEntry[],
  createdAt?: string | null,
): { key: string; label: string; meta: string | null }[] {
  return STEPS.map((s) => {
    const last = [...history].reverse().find((h) => h.toStatus === s.key);
    const meta = s.key === "DRAFT" ? when(last?.changedAt ?? createdAt) : when(last?.changedAt);
    return { ...s, meta };
  });
}
