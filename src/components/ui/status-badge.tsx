import { cn } from "@/lib/utils";

/**
 * Distintivo de estado ÚNICO de la aplicación. Un mismo vocabulario visual
 * para todos los módulos — el significado del color es constante:
 *   neutral → borrador / inactivo      warning → requiere acción / en curso
 *   brand   → hito comercial (VENDIDA)  info    → avanzado, aún no final
 *   success → completado / final        danger  → bloqueado / rechazado
 */
export type StatusTone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

export type StatusDomain =
  | "sale"
  | "contract"
  | "liquidation"
  | "editRequest"
  | "settlement"
  | "commission"
  | "logistics"
  | "account";

type Entry = { label: string; tone: StatusTone };

const DEFS: Record<StatusDomain, Record<string, Entry>> = {
  sale: {
    DRAFT: { label: "Borrador", tone: "neutral" },
    PENDING: { label: "Pendiente", tone: "warning" },
    SOLD: { label: "Vendida", tone: "brand" },
    PAID: { label: "Pagada", tone: "success" },
    CANCELLED: { label: "Cancelada", tone: "danger" },
  },
  contract: {
    NOT_SENT: { label: "Por enviar", tone: "danger" },
    SENT: { label: "Enviado", tone: "warning" },
    SIGNED: { label: "Firmado", tone: "info" },
    ACCREDITED: { label: "Acreditado", tone: "success" },
  },
  liquidation: {
    NONE: { label: "Sin liquidación", tone: "neutral" },
    DRAFT: { label: "Borrador", tone: "warning" },
    APPROVED: { label: "Aprobada", tone: "info" },
    PAID: { label: "Pagada", tone: "success" },
  },
  editRequest: {
    PENDING: { label: "Pendiente", tone: "warning" },
    APPROVED: { label: "Aprobada", tone: "success" },
    REJECTED: { label: "Rechazada", tone: "danger" },
    CANCELLED: { label: "Cancelada", tone: "neutral" },
  },
  settlement: {
    PENDING: { label: "Pendiente", tone: "warning" },
    SETTLED: { label: "Liquidado", tone: "success" },
  },
  commission: {
    PENDING: { label: "Pendiente", tone: "warning" },
    ELIGIBLE: { label: "Elegible", tone: "success" },
    VOID: { label: "Anulada", tone: "neutral" },
  },
  logistics: {
    PENDING_PREPARATION: { label: "Pendiente de preparar", tone: "neutral" },
    READY: { label: "Lista", tone: "info" },
    DISPATCHED: { label: "Despachada", tone: "info" },
    IN_TRANSIT: { label: "En tránsito", tone: "info" },
    IN_CUBA: { label: "En Cuba", tone: "info" },
    READY_FOR_DELIVERY: { label: "Lista para entrega", tone: "warning" },
    DELIVERED: { label: "Entregada", tone: "success" },
    ON_HOLD: { label: "En espera", tone: "danger" },
  },
  account: {
    INVITED: { label: "Invitado", tone: "info" },
    ACTIVE: { label: "Activo", tone: "success" },
    SUSPENDED: { label: "Suspendido", tone: "warning" },
    DISABLED: { label: "Deshabilitado", tone: "neutral" },
  },
};

export const TONE_CLASS: Record<StatusTone, { pill: string; dot: string }> = {
  neutral: { pill: "border-border-strong bg-surface-muted text-text-secondary", dot: "bg-muted-foreground" },
  brand: { pill: "border-brand/35 bg-brand-soft text-brand", dot: "bg-brand" },
  success: { pill: "border-success/30 bg-success-soft text-success", dot: "bg-success" },
  warning: { pill: "border-warning/30 bg-warning-soft text-warning", dot: "bg-warning" },
  danger: { pill: "border-danger/30 bg-danger-surface text-danger", dot: "bg-danger" },
  info: { pill: "border-info/30 bg-info-soft text-info", dot: "bg-info" },
};

export function statusEntry(domain: StatusDomain, status: string | null | undefined): Entry {
  if (!status) return { label: "—", tone: "neutral" };
  return DEFS[domain][status] ?? { label: status, tone: "neutral" };
}

export function statusLabel(domain: StatusDomain, status: string | null | undefined): string {
  return statusEntry(domain, status).label;
}

export function StatusBadge({
  domain,
  status,
  label,
  tone,
  size = "sm",
  className,
}: {
  domain: StatusDomain;
  status: string | null | undefined;
  /** Sobrescribe la etiqueta (conservando el tono del estado). */
  label?: string;
  tone?: StatusTone;
  size?: "xs" | "sm" | "md";
  className?: string;
}) {
  const entry = statusEntry(domain, status);
  const t = TONE_CLASS[tone ?? entry.tone];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border font-semibold uppercase tracking-wide",
        size === "xs" && "px-2 py-0.5 text-[10px]",
        size === "sm" && "px-2.5 py-0.5 text-[11px]",
        size === "md" && "px-3 py-1 text-xs",
        t.pill,
        className,
      )}
    >
      <span aria-hidden="true" className={cn("h-1.5 w-1.5 rounded-full", t.dot)} />
      {label ?? entry.label}
    </span>
  );
}
