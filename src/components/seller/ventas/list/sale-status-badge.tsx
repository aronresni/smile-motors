import { StatusBadge } from "@/components/ui/status-badge";
import type { SaleListStatus } from "@/lib/seller/sales-list";

/** Distintivo de estado comercial: Borrador / Pendiente / Vendida / Pagada.
 * Delegado en el `StatusBadge` único de la app (mismo vocabulario visual en
 * vendedor y admin). */
export function SaleStatusBadge({
  status,
  className,
  size,
}: {
  status: SaleListStatus;
  className?: string;
  size?: "xs" | "sm" | "md";
}) {
  return <StatusBadge domain="sale" status={status} className={className} size={size} />;
}
