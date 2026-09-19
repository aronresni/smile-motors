import type { ReactNode } from "react";
import { ProcessStepper, type ProcessStep } from "@/components/ui/process-stepper";
import { AlertTriangleIcon, CreditCardIcon, FileTextIcon, TruckIcon } from "@/components/ui/icons";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { LOGISTICS_STATUS_LABEL, type LogisticsStatus } from "@/lib/sales/logistics-types";

export { commercialSteps } from "@/lib/sales/process";

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "brand";
export interface OpsChip {
  key: string;
  label: string;
  value: string;
  tone: Tone;
  icon: ReactNode;
  href?: string;
}

const TONE: Record<Tone, string> = {
  neutral: "text-text-secondary",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  info: "text-info",
  brand: "text-brand",
};

export function buildOpsChips(input: {
  status: string;
  financing: { total: number; accredited: number; signed: number; sent: number; notSent: number };
  settlement: { collectedCents: number; saleTotalCents: number; outstandingCents: number };
  logistics: LogisticsStatus[];
}): OpsChip[] {
  const { status, financing: f, settlement: s } = input;

  const fin: OpsChip =
    f.total === 0
      ? { key: "fin", label: "Financiación", value: "Sin financiera", tone: "neutral", icon: <FileTextIcon size={16} /> }
      : f.accredited === f.total
        ? { key: "fin", label: "Financiación", value: `${f.total}/${f.total} acreditados`, tone: "success", icon: <FileTextIcon size={16} />, href: "#contratos" }
        : {
            key: "fin",
            label: "Financiación",
            value:
              f.notSent > 0
                ? `${f.notSent} por enviar`
                : f.sent > 0
                  ? `${f.sent} por firmar`
                  : `${f.signed} firmado(s) · ${f.accredited} acreditado(s)`,
            tone: f.notSent > 0 || f.sent > 0 ? "warning" : "info",
            icon: <FileTextIcon size={16} />,
            href: "#contratos",
          };

  const cob: OpsChip =
    status === "DRAFT"
      ? { key: "cob", label: "Cobro", value: "Aún no inicia", tone: "neutral", icon: <CreditCardIcon size={16} /> }
      : s.outstandingCents <= 0 && s.collectedCents === s.saleTotalCents && s.saleTotalCents > 0
        ? { key: "cob", label: "Cobro", value: "Completo", tone: "success", icon: <CreditCardIcon size={16} />, href: "#pagos" }
        : {
            key: "cob",
            label: "Cobro",
            value: `${formatCents(s.collectedCents)} de ${formatCents(s.saleTotalCents)}`,
            tone: s.collectedCents > s.saleTotalCents ? "danger" : "warning",
            icon: <CreditCardIcon size={16} />,
            href: "#pagos",
          };

  const uniq = [...new Set(input.logistics)];
  const log: OpsChip =
    input.logistics.length === 0
      ? { key: "log", label: "Logística", value: status === "SOLD" || status === "PAID" ? "Sin datos" : "Inicia al vender", tone: "neutral", icon: <TruckIcon size={16} /> }
      : uniq.length === 1
        ? {
            key: "log",
            label: "Logística",
            value: LOGISTICS_STATUS_LABEL[uniq[0]],
            tone: uniq[0] === "DELIVERED" ? "success" : uniq[0] === "ON_HOLD" ? "danger" : "info",
            icon: <TruckIcon size={16} />,
            href: "#logistica",
          }
        : {
            key: "log",
            label: "Logística",
            value: `${input.logistics.filter((x) => x === "DELIVERED").length}/${input.logistics.length} entregadas`,
            tone: input.logistics.includes("ON_HOLD") ? "danger" : "info",
            icon: <TruckIcon size={16} />,
            href: "#logistica",
          };

  return [fin, cob, log];
}

/**
 * Explica el proceso completo de un vistazo: stepper comercial (BORRADOR →
 * PENDIENTE → VENDIDA → PAGADA) + estados operativos SEPARADOS (financiación,
 * cobro, logística) — nunca todo mezclado en un único estado.
 */
export function SaleProcessOverview({
  status,
  steps,
  chips,
}: {
  status: string;
  steps: ProcessStep[];
  chips: OpsChip[];
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Proceso comercial</p>
      {status === "CANCELLED" ? (
        <p className="text-sm text-danger">Venta cancelada.</p>
      ) : (
        <ProcessStepper steps={steps} currentKey={status} />
      )}
      <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {chips.map((c) => {
          const body = (
            <>
              <span className={cn("shrink-0", TONE[c.tone])}>{c.icon}</span>
              <span className="min-w-0">
                <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{c.label}</span>
                <span className={cn("block truncate text-sm font-semibold", TONE[c.tone])}>{c.value}</span>
              </span>
            </>
          );
          const cls = "flex items-center gap-2.5 rounded-xl border border-border bg-surface-muted px-3 py-2.5";
          return c.href ? (
            <a key={c.key} href={c.href} className={cn(cls, "transition-colors hover:border-border-strong hover:bg-surface-elevated")}>
              {body}
            </a>
          ) : (
            <div key={c.key} className={cls}>
              {body}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Señal DERIVADA de conciliación (nunca muta dinero ni fabrica pagos). */
export function ReconciliationBanner({
  saleTotalCents,
  allocatedNetCents,
  collectedCents,
  status,
}: {
  saleTotalCents: number;
  allocatedNetCents: number;
  collectedCents: number;
  status: string;
}) {
  const allocDiff = allocatedNetCents - saleTotalCents;
  const over = (status === "SOLD" || status === "PAID") && collectedCents > saleTotalCents;
  if (allocDiff === 0 && !over) return null;
  return (
    <div role="status" className="rounded-2xl border border-danger/35 bg-danger-surface p-4">
      <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-danger">
        <AlertTriangleIcon size={15} /> Conciliación requerida
      </p>
      <ul className="mt-2 space-y-1 text-sm text-foreground">
        {allocDiff !== 0 && (
          <li>
            Los pagos asignados suman {formatCents(allocatedNetCents)} (neto) y el total de la venta es{" "}
            {formatCents(saleTotalCents)} — diferencia de{" "}
            <strong className={allocDiff > 0 ? "text-danger" : "text-warning"}>
              {allocDiff > 0 ? "+" : "−"}
              {formatCents(Math.abs(allocDiff))}
            </strong>
            {allocDiff > 0 ? " (sobrepago)" : " (falta asignar)"}.
          </li>
        )}
        {over && (
          <li>
            Lo cobrado/acreditado ({formatCents(collectedCents)}) supera el total de la venta ({formatCents(saleTotalCents)}).
          </li>
        )}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        Ningún pago acreditado o liquidado se modificó automáticamente. MARCAR COMO PAGADA permanece bloqueado hasta que
        cobro y total coincidan exactamente.
      </p>
    </div>
  );
}
