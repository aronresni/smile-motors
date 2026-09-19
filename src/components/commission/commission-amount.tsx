import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { commissionReasonText, type CommissionPreview } from "@/lib/sales/commission-preview";

/**
 * Importe de comisión de una venta con su naturaleza SIEMPRE visible:
 * confirmada (verde) · ESTIMADA — no incluida en la liquidación (naranja) ·
 * "Sin calcular" · "Sin comisión". Una estimación nunca se presenta como dinero
 * a cobrar.
 */
export function CommissionAmount({
  preview,
  status,
  align = "right",
  className,
}: {
  preview: CommissionPreview;
  /** Estado comercial de la venta (para el rótulo de borrador). */
  status: string;
  align?: "left" | "right";
  className?: string;
}) {
  const reason = commissionReasonText(preview.reason);
  const alignClass = align === "right" ? "text-right" : "text-left";

  if (preview.kind === "FROZEN" && preview.totalCents != null) {
    return (
      <div className={cn(alignClass, className)}>
        <p className="font-semibold tabular-nums text-success">{formatCents(preview.totalCents)}</p>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-success/80">Confirmada</p>
      </div>
    );
  }
  if (preview.kind === "ESTIMATED" && preview.totalCents != null) {
    return (
      <div className={cn(alignClass, className)}>
        <p className="font-semibold tabular-nums text-warning">{formatCents(preview.totalCents)}</p>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-warning">
          {status === "DRAFT" ? "Estimada · borrador — no liquidable" : "Estimada — no incluida en la liquidación"}
        </p>
      </div>
    );
  }
  if (preview.kind === "UNAVAILABLE") {
    return (
      <div className={cn(alignClass, className)}>
        <p className="text-xs font-medium text-muted-foreground">Sin calcular</p>
        {reason && <p className="text-[10px] text-muted-foreground">{reason}</p>}
      </div>
    );
  }
  return (
    <div className={cn(alignClass, className)}>
      <p className="text-xs font-medium text-muted-foreground">Sin comisión</p>
      {reason && <p className="text-[10px] text-muted-foreground">{reason}</p>}
    </div>
  );
}
