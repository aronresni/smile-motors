import type { ReactNode } from "react";
import { formatCents } from "@/lib/money";
import type { SellerCommissionKpis } from "@/lib/seller/commissions";
import { LayersIcon, TargetIcon, WalletIcon } from "@/components/seller/icons";

function Card({
  label,
  icon,
  children,
  hint,
}: {
  label: string;
  icon: ReactNode;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-3.5 sm:p-4">
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

/** KPIs de comisión del vendedor — solo lo propio, por estado de COBRO de la
 * venta. Ambas se liquidan desde que la venta queda VENDIDA. */
export function SellerCommissionKpiCards({ kpis }: { kpis: SellerCommissionKpis }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-4">
      <Card label="Por cobrar" icon={<LayersIcon size={16} />} hint="Ventas vendidas que el cliente aún no terminó de pagar">
        {kpis.pendingCount}
      </Card>
      <Card label="Cobradas" icon={<TargetIcon size={16} />} hint="Ventas ya pagadas por el cliente">
        {kpis.eligibleCount}
      </Card>
      <Card label="Total por cobrar" icon={<WalletIcon size={16} />}>
        {formatCents(kpis.pendingAmountCents)}
      </Card>
      <Card label="Total cobrado" icon={<WalletIcon size={16} />}>
        {formatCents(kpis.eligibleAmountCents)}
      </Card>
    </div>
  );
}
