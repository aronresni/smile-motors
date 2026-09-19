import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminProviderDetail } from "@/lib/admin/financing";
import { formatCents } from "@/lib/money";
import { formatBps } from "@/lib/payments/fee-engine";
import { ROUTES } from "@/lib/constants";
import { EditProviderModal } from "@/components/admin/financing/provider-form";
import { ProviderActiveToggle } from "@/components/admin/financing/provider-active-toggle";
import { PlanManager } from "@/components/admin/financing/plan-manager";

export const metadata: Metadata = { title: "Financiera · Admin" };
export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  CARD: "Tarjeta",
  ZELLE: "Zelle",
  FINANCING: "Financiación",
  INTERNAL: "Efectivo / interno",
};

const EVENT_LABEL: Record<string, string> = {
  PROVIDER_CREATED: "Proveedor creado",
  PROVIDER_UPDATED: "Proveedor actualizado",
  PROVIDER_ACTIVATED: "Proveedor activado",
  PROVIDER_DEACTIVATED: "Proveedor desactivado",
  PLAN_CREATED: "Plan creado",
  PLAN_UPDATED: "Plan actualizado",
  PLAN_DEACTIVATED: "Plan desactivado",
};

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("es-DO", { dateStyle: "medium", timeStyle: "short" }).format(d);
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
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
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-foreground">{value || "—"}</p>
    </div>
  );
}

function feeDescription(provider: {
  fee_strategy: string;
  flat_fee_bps: number | null;
  flat_fee_cents: number | null;
  conditional_threshold_cents: number | null;
  conditional_below_fee_cents: number | null;
  conditional_above_fee_bps: number | null;
}): string {
  switch (provider.fee_strategy) {
    case "NONE":
      return "Sin comisión";
    case "FLAT_RATE":
      return `${formatBps(provider.flat_fee_bps)} sobre el bruto`;
    case "FIXED_AMOUNT":
      return `Cargo fijo de ${formatCents(provider.flat_fee_cents ?? 0)}`;
    case "FIXED_PLUS_PERCENT":
      return `${formatCents(provider.flat_fee_cents ?? 0)} + ${formatBps(provider.flat_fee_bps)}`;
    case "INSTALLMENTS":
      return "Cada plan define su propia comisión (ver planes abajo)";
    case "CONDITIONAL":
      return `Si el bruto ≤ ${formatCents(provider.conditional_threshold_cents ?? 0)}: ${formatCents(
        provider.conditional_below_fee_cents ?? 0,
      )} fijo. Si es mayor: ${formatBps(provider.conditional_above_fee_bps)}.`;
    default:
      return provider.fee_strategy;
  }
}

export default async function AdminFinancieraDetailPage({
  params,
}: {
  params: Promise<{ providerId: string }>;
}) {
  const { providerId } = await params;
  const detail = await getAdminProviderDetail(providerId);
  if (!detail) notFound();

  const { provider, plans, usage, recentEvents } = detail;
  const isFinancing = provider.method_type === "FINANCING";

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <Link href={ROUTES.adminFinancieras} className="text-xs text-muted-foreground hover:text-foreground">
          ← Financieras
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">{provider.name}</h1>
          <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide border-border">
            {TYPE_LABEL[provider.method_type] ?? provider.method_type}
          </span>
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
              provider.is_active
                ? "border-success/30 bg-success/10 text-success"
                : "border-border bg-surface-muted text-muted-foreground"
            }`}
          >
            {provider.is_active ? "Activo" : "Inactivo"}
          </span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">Código interno: {provider.legacy_id}</p>
      </div>

      <Section title="Información general" action={<EditProviderModal provider={provider} />}>
        <div className="grid grid-cols-2 gap-3">
          <Fact label="Descripción" value={provider.subtext ?? "—"} />
          <Fact label="Orden en el selector" value={String(provider.position)} />
        </div>
        {provider.instructions && (
          <div className="mt-3 border-t pt-3 border-border">
            <p className="text-[11px] text-muted-foreground">Instrucciones</p>
            <p className="mt-0.5 whitespace-pre-wrap text-sm text-foreground">{provider.instructions}</p>
          </div>
        )}
      </Section>

      <Section title="Estado">
        <div className="flex items-center justify-between">
          <p className="text-sm text-text-secondary">
            {provider.is_active
              ? "Disponible para ventas nuevas."
              : "No seleccionable en ventas nuevas. Las ventas históricas que ya lo usan se muestran sin cambios."}
          </p>
          <ProviderActiveToggle providerId={provider.id} providerName={provider.name} isActive={provider.is_active} />
        </div>
      </Section>

      <Section title="Comisión (configuración actual)">
        <p className="text-sm text-foreground">{feeDescription(provider)}</p>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Esto aplica a ventas NUEVAS. Las ventas ya registradas conservan el fee vigente al momento de crear la
          asignación de pago, aunque esta configuración cambie después.
        </p>
      </Section>

      {isFinancing && (
        <Section title="Contrato y restricciones">
          <div className="grid grid-cols-2 gap-3">
            <Fact label="Requiere contrato firmado" value={provider.requires_signed_contract ? "Sí" : "No"} />
            <Fact label="Solo clientes de Florida" value={provider.only_florida ? "Sí" : "No"} />
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Cambiar esto aquí NO afecta ventas ya registradas: cada venta guarda si el contrato era obligatorio al
            momento de asignar el pago. La restricción de Florida se valida siempre en el servidor al crear/enviar
            la venta, nunca solo ocultando la opción en la pantalla.
          </p>
          {provider.website_url && (
            <p className="mt-2 text-sm">
              Portal:{" "}
              <a href={provider.website_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                {provider.website_url}
              </a>
            </p>
          )}
        </Section>
      )}

      {isFinancing && (
        <Section title="Planes">
          <PlanManager providerId={provider.id} plans={plans} />
        </Section>
      )}

      <Section title="Uso">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Fact label="Ventas que lo usan" value={String(usage.salesCount)} />
          <Fact label="Bruto asignado" value={formatCents(usage.grossAllocatedCents)} />
          <Fact label="Neto acreditado" value={formatCents(usage.netAccreditedCents)} />
        </div>
        {isFinancing && (
          <div className="mt-3 grid grid-cols-3 gap-3 border-t pt-3 border-border">
            <Fact label="Contratos enviados" value={String(usage.contractsSent)} />
            <Fact label="Firmados" value={String(usage.contractsSigned)} />
            <Fact label="Acreditados" value={String(usage.contractsAccredited)} />
          </div>
        )}
      </Section>

      <Section title="Historial de configuración">
        {recentEvents.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sin cambios registrados todavía.</p>
        ) : (
          <ul className="space-y-2">
            {recentEvents.map((e, i) => (
              <li key={i} className="flex items-start justify-between gap-2 text-xs">
                <span>
                  <span className="font-medium text-text-secondary">
                    {EVENT_LABEL[e.eventType] ?? e.eventType}
                  </span>
                  {e.planLabel && <span className="text-muted-foreground"> · {e.planLabel}</span>}
                  {e.actorName && <span className="text-muted-foreground"> · {e.actorName}</span>}
                </span>
                <span className="shrink-0 text-muted-foreground">{formatDateTime(e.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
