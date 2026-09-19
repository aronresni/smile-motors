import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { formatCents } from "@/lib/money";
import type { SellerSalesListSummary } from "@/lib/seller/sales-list";
import {
  LayersIcon,
  ReceiptIcon,
  TargetIcon,
  WalletIcon,
} from "@/components/seller/icons";

function Card({
  label,
  icon,
  children,
  hint,
  loading,
}: {
  label: string;
  icon: ReactNode;
  children: ReactNode;
  hint?: string;
  loading?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-surface p-3.5 sm:p-4",
        loading && "animate-pulse",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground sm:text-[11px]">
          {label}
        </span>
        <span className="hidden text-text-secondary sm:block">{icon}</span>
      </div>
      <div className="mt-2 text-lg font-semibold tabular-nums tracking-tight text-foreground sm:text-2xl">
        {children}
      </div>
      {hint && (
        <p className="mt-1.5 text-[10px] text-muted-foreground sm:text-[11px]">
          {hint}
        </p>
      )}
    </div>
  );
}

/**
 * Métricas calculadas SIEMPRE sobre el filtro actual (búsqueda + período +
 * estado + tipo). Datos reales de la RPC; la comisión no tiene motor todavía.
 */
export function SalesListSummary({
  summary,
  loading,
}: {
  summary: SellerSalesListSummary;
  loading?: boolean;
}) {
  const opsHint =
    summary.operations > 0
      ? `${summary.soldCount} vendidas · ${summary.paidCount} pagadas · ${summary.pendingCount} pendientes · ${summary.draftCount} borradores`
      : "Sin ventas en este filtro";

  return (
    <div className="grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-4">
      <Card
        label="Ventas"
        icon={<ReceiptIcon size={16} />}
        hint={opsHint}
        loading={loading}
      >
        {summary.operations}
      </Card>

      <Card
        label="Volumen vendido"
        icon={<WalletIcon size={16} />}
        hint="Total de ventas vendidas y pagadas"
        loading={loading}
      >
        {formatCents(summary.volumeCents)}
      </Card>

      <Card
        label="Unidades"
        icon={<LayersIcon size={16} />}
        hint="Unidades de ventas vendidas y pagadas"
        loading={loading}
      >
        {summary.unitsSold}
      </Card>

      <Card
        label="Comisión"
        icon={<TargetIcon size={16} />}
        hint="El motor de comisiones aún no está configurado"
        loading={loading}
      >
        <span className="text-sm font-semibold text-muted-foreground sm:text-base">
          Pendiente de configuración
        </span>
      </Card>
    </div>
  );
}
