import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireZone } from "@/lib/auth/session";
import { getSellerLiquidationDetail } from "@/lib/seller/liquidations";
import { formatCents } from "@/lib/money";
import { LiquidationActivitySection } from "@/components/seller/liquidaciones/liquidation-activity-section";
import { LiquidationCommissionItems } from "@/components/seller/liquidaciones/liquidation-commission-items";
import { LiquidationAdjustmentsList } from "@/components/seller/liquidaciones/liquidation-adjustments-list";

export const metadata: Metadata = { title: "Liquidación · Vendedor" };
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = { APPROVED: "Aprobada", PAID: "Pagada" };

function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("es-DO", { dateStyle: "medium", timeZone: "UTC" }).format(d);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      {children}
    </div>
  );
}

export default async function SellerLiquidationDetailPage({
  params,
}: {
  params: Promise<{ settlementId: string }>;
}) {
  await requireZone("seller");
  const { settlementId } = await params;
  const detail = await getSellerLiquidationDetail(settlementId);
  if (!detail) notFound();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">
            {formatDate(detail.weekStart)} – {formatDate(detail.weekEnd)}
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-foreground">
            {STATUS_LABEL[detail.status] ?? detail.status}
          </h1>
          {detail.paymentReference && <p className="mt-1 text-sm text-muted-foreground">Ref. {detail.paymentReference}</p>}
        </div>
        <div className="text-right">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Total</p>
          <p className="text-2xl font-semibold tabular-nums text-foreground">{formatCents(detail.totalCents)}</p>
        </div>
      </div>

      <Section title="Comisiones a liquidar">
        <div className="mb-3 grid grid-cols-3 gap-3 text-sm">
          <div>
            <p className="text-[11px] text-muted-foreground">Subtotal</p>
            <p className="font-medium tabular-nums text-foreground">{formatCents(detail.subtotalCents)}</p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">Ajustes</p>
            <p className="font-medium tabular-nums text-foreground">{formatCents(detail.adjustmentsCents)}</p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">Total</p>
            <p className="font-semibold tabular-nums text-foreground">{formatCents(detail.totalCents)}</p>
          </div>
        </div>
        <LiquidationCommissionItems items={detail.commissionItems} />
      </Section>

      {detail.adjustments.length > 0 && (
        <Section title="Ajustes">
          <LiquidationAdjustmentsList adjustments={detail.adjustments} />
        </Section>
      )}

      <Section title="Actividad de la semana">
        <LiquidationActivitySection activity={detail.activity} />
      </Section>
    </div>
  );
}
