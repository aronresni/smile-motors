import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getEditRequestDetail } from "@/lib/admin/approvals";
import { describeChangeField, formatAuditValue, isMoneyChangeField } from "@/lib/sales/confirmed-edit-transport";
import { ROUTES } from "@/lib/constants";
import { EditRequestReviewActions } from "@/components/admin/approvals/edit-request-review-actions";

export const metadata: Metadata = { title: "Revisar edición · Admin" };
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Pendiente",
  APPROVED: "Aprobada",
  REJECTED: "Rechazada",
  CANCELLED: "Cancelada",
};

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("es-DO", { dateStyle: "medium", timeStyle: "short" }).format(d);
}

export default async function AdminEditRequestReviewPage({
  params,
}: {
  params: Promise<{ requestId: string }>;
}) {
  const { requestId } = await params;
  const detail = await getEditRequestDetail(requestId);
  if (!detail) notFound();

  const hasConflict = detail.status === "PENDING" && detail.changes.some((c) => !c.stillMatchesCurrent);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <Link href={`${ROUTES.adminAprobaciones}?tab=ediciones`} className="text-xs text-muted-foreground hover:text-foreground">
          ← Aprobaciones · Ediciones
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">Solicitud de edición</h1>
          <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide border-border">
            {STATUS_LABEL[detail.status] ?? detail.status}
          </span>
        </div>
      </div>

      <div className="rounded-xl border p-4 border-border bg-surface">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-[11px] text-muted-foreground">Venta</p>
            <Link href={`${ROUTES.adminVentas}/${detail.sale.id}`} className="mt-0.5 block text-sm font-medium hover:underline">
              {detail.sale.saleNumber ?? "Sin número"}
            </Link>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">Estado actual de la venta</p>
            <p className="mt-0.5 text-sm font-medium">{detail.sale.status}</p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">Vendedor</p>
            <p className="mt-0.5 text-sm font-medium">{detail.sale.sellerName}</p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">Cliente</p>
            <p className="mt-0.5 text-sm font-medium">{detail.sale.buyerName}</p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">Solicitada</p>
            <p className="mt-0.5 text-sm font-medium">{formatDateTime(detail.createdAt)}</p>
          </div>
          {detail.reviewedAt && (
            <div>
              <p className="text-[11px] text-muted-foreground">Revisada</p>
              <p className="mt-0.5 text-sm font-medium">
                {formatDateTime(detail.reviewedAt)}{detail.reviewedByName ? ` · ${detail.reviewedByName}` : ""}
              </p>
            </div>
          )}
        </div>
        <div className="mt-3 border-t pt-3 border-border">
          <p className="text-[11px] text-muted-foreground">Motivo del vendedor</p>
          <p className="mt-0.5 text-sm text-foreground">{detail.reason}</p>
        </div>
        {detail.reviewNote && (
          <div className="mt-3 border-t pt-3 border-border">
            <p className="text-[11px] text-muted-foreground">Nota de revisión</p>
            <p className="mt-0.5 text-sm text-foreground">{detail.reviewNote}</p>
          </div>
        )}
      </div>

      <div className="rounded-xl border p-4 border-border bg-surface">
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Cambios propuestos</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground border-border">
                <th className="py-1.5 pr-3 font-medium">Campo</th>
                <th className="py-1.5 pr-3 font-medium">Antes</th>
                <th className="py-1.5 pr-3 font-medium">Después</th>
              </tr>
            </thead>
            <tbody>
              {detail.changes.map((c, i) => (
                <tr key={i} className="border-b last:border-0 border-border/70">
                  <td className="py-1.5 pr-3 font-medium">
                    {describeChangeField(c.path)}
                    {!c.stillMatchesCurrent && (
                      <span className="ml-1.5 inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase border-danger/30 bg-danger/10 text-danger">
                        Cambió
                      </span>
                    )}
                  </td>
                  <td className={`py-1.5 pr-3 ${isMoneyChangeField(c.path) ? "tabular-nums" : ""}`}>
                    {formatAuditValue(c.path, c.oldValue)}
                  </td>
                  <td className={`py-1.5 pr-3 font-medium ${isMoneyChangeField(c.path) ? "tabular-nums" : ""}`}>
                    {formatAuditValue(c.path, c.newValue)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {detail.status === "PENDING" && (
        <EditRequestReviewActions requestId={detail.requestId} saleId={detail.sale.id} hasConflict={hasConflict} />
      )}
    </div>
  );
}
