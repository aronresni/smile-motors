import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { getAdminDashboardData } from "@/lib/admin/dashboard";
import { getAlertsSummary } from "@/lib/admin/alerts";
import { getActivityFeed } from "@/lib/admin/activity";
import { getCommissionKpis } from "@/lib/admin/commissions";
import { getApprovalsCounts } from "@/lib/admin/approvals";
import { RequierenAtencionWidget } from "@/components/admin/approvals/requieren-atencion-widget";
import { ActivityList } from "@/components/admin/activity/activity-list";
import { ROUTES } from "@/lib/constants";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { PageHeader, SectionHeader } from "@/components/ui/page-header";
import { Card, KpiCard } from "@/components/ui/card";
import {
  ActivityIcon,
  AlertTriangleIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  PackageIcon,
  ReceiptIcon,
  TruckIcon,
  UserPlusIcon,
  WalletIcon,
  type IconProps,
} from "@/components/ui/icons";
import {
  PERIOD_OPTIONS,
  defaultPeriod,
  resolveRange,
  type PeriodKind,
} from "@/lib/seller/period";

export const metadata: Metadata = { title: "Panel de administración" };
export const dynamic = "force-dynamic";

const PERIOD_VALUES = new Set(PERIOD_OPTIONS.map((o) => o.kind));

function QuickAction({
  href,
  label,
  hint,
  Icon,
  count,
}: {
  href: string;
  label: string;
  hint: string;
  Icon: (p: IconProps) => ReactNode;
  count?: number;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-2xl border border-border bg-surface p-3.5 transition-colors hover:border-brand/40 hover:bg-surface-muted active:scale-[0.99]"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand transition-colors group-hover:bg-brand group-hover:text-brand-foreground">
        <Icon size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
          {label}
          {Boolean(count) && (
            <span className="rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-bold leading-none text-brand-foreground">
              {count}
            </span>
          )}
        </span>
        <span className="block truncate text-xs text-muted-foreground">{hint}</span>
      </span>
      <ArrowRightIcon size={16} className="shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />
    </Link>
  );
}

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const periodRaw = Array.isArray(sp.period) ? sp.period[0] : sp.period;
  const kind: PeriodKind = PERIOD_VALUES.has(periodRaw as PeriodKind)
    ? (periodRaw as PeriodKind)
    : defaultPeriod().kind;
  const range = resolveRange({ kind, anchor: defaultPeriod().anchor });

  const [data, alertsSummary, commissionKpis, recentActivity, approvals] = await Promise.all([
    getAdminDashboardData(range.startISO, range.endISO),
    getAlertsSummary(),
    getCommissionKpis(),
    getActivityFeed({ limit: 6 }),
    getApprovalsCounts(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Smile Motors"
        title="Panel de administración"
        description="Operación comercial en vivo: ventas pendientes, vendidas, cobro y pagos."
        actions={
          <div className="flex gap-1 rounded-xl border border-border bg-surface p-1" role="group" aria-label="Período">
            {PERIOD_OPTIONS.map((opt) => (
              <Link
                key={opt.kind}
                href={`/admin?period=${opt.kind}`}
                scroll={false}
                aria-current={opt.kind === kind ? "true" : undefined}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                  opt.kind === kind ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {opt.short}
              </Link>
            ))}
          </div>
        }
      />

      <RequierenAtencionWidget summary={alertsSummary} />

      <section>
        <SectionHeader title="Acciones rápidas" />
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
          <QuickAction href={ROUTES.adminVentas} label="Ver ventas" hint="Buscar, filtrar y gestionar cualquier venta" Icon={ReceiptIcon} />
          <QuickAction href={ROUTES.adminAprobaciones} label="Ver aprobaciones" hint="Ediciones, contratos y cobros" Icon={CheckCircleIcon} count={approvals.totalPending} />
          <QuickAction href={ROUTES.adminAlertas} label="Ver alertas" hint="Lo que requiere atención" Icon={AlertTriangleIcon} count={alertsSummary.total} />
          <QuickAction href={ROUTES.adminLiquidaciones} label="Ver liquidaciones" hint="Pagos semanales a vendedores" Icon={WalletIcon} />
          <QuickAction href={`${ROUTES.adminVendedores}?nuevo=1`} label="Invitar vendedor" hint="Enviar invitación de acceso" Icon={UserPlusIcon} />
          <QuickAction href={`${ROUTES.adminProductos}?nuevo=1`} label="Agregar producto" hint="Nuevo modelo en el catálogo" Icon={PackageIcon} />
          <QuickAction href={ROUTES.adminLogistica} label="Ver logística" hint="Seguimiento y entrega de unidades" Icon={TruckIcon} />
          <QuickAction href={ROUTES.adminActividad} label="Ver actividad" hint="Auditoría de toda la operación" Icon={ActivityIcon} />
        </div>
      </section>

      <section>
        <SectionHeader title={`Ventas · ${range.label}`} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <KpiCard label="Pendientes" value={String(data.pendingCount)} hint="En revisión" tone="warning" href={`${ROUTES.adminVentas}?status=PENDING`} />
          <KpiCard label="Vendidas" value={String(data.soldCount)} hint="Cualquier estado de cobro" tone="brand" href={`${ROUTES.adminVentas}?status=SOLD`} />
          <KpiCard label="Pendientes a cobrar" value={String(data.pendingCollectionCount)} hint="Vendidas con saldo" tone="warning" href={`${ROUTES.adminVentas}?collection=pending_collection`} />
          <KpiCard label="Listas para pagar" value={String(data.readyToPayCount)} hint="Cobro completo" tone="success" href={`${ROUTES.adminVentas}?collection=ready_to_pay`} />
          <KpiCard label="Pagadas" value={String(data.paidCount)} hint="Liquidación confirmada" tone="success" href={`${ROUTES.adminVentas}?status=PAID`} />
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KpiCard label="Monto pendiente a cobrar" value={formatCents(data.outstandingAmountCents)} hint="Saldo de todas las ventas vendidas" tone="warning" />
          <KpiCard label="Monto pagado" value={formatCents(data.paidAmountCentsPeriod)} hint={`Ventas pagadas en el período (${range.label})`} tone="success" />
          <KpiCard label="Comisiones elegibles" value={String(commissionKpis.eligibleCount)} hint="Para la próxima liquidación" tone="info" href={ROUTES.adminComisiones} />
        </div>
      </section>

      <Card>
        <SectionHeader
          title="Actividad reciente"
          icon={<ActivityIcon size={15} />}
          actions={
            <Link href={ROUTES.adminActividad} className="text-xs font-semibold text-brand hover:underline">
              Ver toda la actividad →
            </Link>
          }
        />
        <ActivityList items={recentActivity.items} />
      </Card>
    </div>
  );
}
