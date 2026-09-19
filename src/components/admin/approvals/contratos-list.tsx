import { formatCents } from "@/lib/money";
import type { ContractInboxItem } from "@/lib/admin/approvals";
import { ContractRowAction } from "@/components/admin/approvals/contract-row-action";
import { StatusBadge } from "@/components/ui/status-badge";

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("es-DO", { dateStyle: "medium" }).format(d);
}

export function ContratosList({ items }: { items: ContractInboxItem[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed px-6 py-14 text-center border-border">
        <p className="text-sm font-medium text-text-secondary">No hay contratos que requieran acción.</p>
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground border-border bg-surface">
              <th className="px-3 py-2.5 font-medium">Venta</th>
              <th className="px-3 py-2.5 font-medium">Vendedor</th>
              <th className="px-3 py-2.5 font-medium">Cliente</th>
              <th className="px-3 py-2.5 font-medium">Financiera</th>
              <th className="px-3 py-2.5 font-medium">Plan</th>
              <th className="px-3 py-2.5 font-medium">Bruto</th>
              <th className="px-3 py-2.5 font-medium">Neto</th>
              <th className="px-3 py-2.5 font-medium">Estado</th>
              <th className="px-3 py-2.5 font-medium">Actualizado</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.allocationId} className="border-b last:border-0 border-border/70">
                <td className="px-3 py-2.5 align-top font-medium">{item.saleNumber ?? "Sin número"}</td>
                <td className="px-3 py-2.5 align-top text-text-secondary">{item.sellerName}</td>
                <td className="px-3 py-2.5 align-top text-text-secondary">{item.buyerName}</td>
                <td className="px-3 py-2.5 align-top">{item.providerName}</td>
                <td className="px-3 py-2.5 align-top text-muted-foreground">{item.planLabel ?? "—"}</td>
                <td className="px-3 py-2.5 align-top tabular-nums">{formatCents(item.grossCents)}</td>
                <td className="px-3 py-2.5 align-top tabular-nums">{formatCents(item.netCents)}</td>
                <td className="px-3 py-2.5 align-top">
                  <StatusBadge domain="contract" status={item.contractStatus} size="xs" />
                </td>
                <td className="px-3 py-2.5 align-top text-muted-foreground">{formatDate(item.lastUpdate)}</td>
                <td className="px-3 py-2.5 text-right align-top">
                  <ContractRowAction item={item} allocationId={item.allocationId} contractId={item.contractId} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
