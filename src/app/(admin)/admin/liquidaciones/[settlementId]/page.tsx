import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getLiquidationDetail } from "@/lib/admin/liquidations";
import { formatCents } from "@/lib/money";
import { LiquidationActivitySection } from "@/components/seller/liquidaciones/liquidation-activity-section";
import { LiquidationCommissionItems } from "@/components/seller/liquidaciones/liquidation-commission-items";
import { LiquidationAdjustmentsList } from "@/components/seller/liquidaciones/liquidation-adjustments-list";
import { LiquidationAdjustmentForm } from "@/components/admin/liquidations/liquidation-adjustment-form";
import { LiquidationLifecycleActions } from "@/components/admin/liquidations/liquidation-lifecycle-actions";

export const metadata: Metadata = { title: "Liquidación · Admin" };
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = { DRAFT: "Borrador", APPROVED: "Aprobada", PAID: "Pagada" };

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-xl border p-4 border-border bg-surface">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}
function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("es-DO", { dateStyle: "medium", timeZone: "UTC" }).format(d);
}

export default async function AdminLiquidationDetailPage({
  params,
}: {
  params: Promise<{ settlementId: string }>;
}) {
  const { settlementId } = await params;
  const detail = await getLiquidationDetail(settlementId);
  if (!detail) notFound();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {formatDate(detail.weekStart)} – {formatDate(detail.weekEnd)}
          </p>
          <h1 className="mt-1 text-lg font-semibold">{detail.sellerName ?? "—"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {STATUS_LABEL[detail.status] ?? detail.status}
            {detail.paymentReference && ` · Ref. ${detail.paymentReference}`}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Total a liquidar</p>
          <p className="text-2xl font-semibold tabular-nums">{formatCents(detail.totalCents)}</p>
        </div>
      </div>

      <Section title="Comisiones a liquidar">
        <div className="mb-3 grid grid-cols-3 gap-3 text-sm">
          <div>
            <p className="text-[11px] text-muted-foreground">Subtotal comisiones</p>
            <p className="font-medium tabular-nums">{formatCents(detail.subtotalCents)}</p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">Ajustes</p>
            <p className="font-medium tabular-nums">{formatCents(detail.adjustmentsCents)}</p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">Total a pagar</p>
            <p className="font-semibold tabular-nums">{formatCents(detail.totalCents)}</p>
          </div>
        </div>
        <LiquidationCommissionItems items={detail.commissionItems} />
      </Section>

      <Section title="Ajustes manuales">
        <div className="space-y-3">
          <LiquidationAdjustmentsList adjustments={detail.adjustments} />
          {detail.status !== "PAID" && <LiquidationAdjustmentForm liquidationId={detail.id} />}
        </div>
      </Section>

      <Section title="Ciclo de vida">
        <LiquidationLifecycleActions
          liquidationId={detail.id}
          status={detail.status}
          weekClosed={detail.weekClosed}
          closesAt={detail.closesAt}
        />
      </Section>

      <Section title="Actividad de la semana (informativa)">
        <LiquidationActivitySection activity={detail.activity} />
      </Section>
    </div>
  );
}
