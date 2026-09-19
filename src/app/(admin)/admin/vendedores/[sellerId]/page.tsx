import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminSellerDetail } from "@/lib/admin/sellers";
import { formatCents } from "@/lib/money";
import { ROUTES } from "@/lib/constants";
import { SellerDetailActions } from "@/components/admin/sellers/seller-detail-actions";

export const metadata: Metadata = { title: "Vendedor · Admin" };
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  INVITED: "Invitado",
  ACTIVE: "Activo",
  SUSPENDED: "Suspendido",
  DISABLED: "Deshabilitado",
};

const EVENT_LABEL: Record<string, string> = {
  SELLER_INVITED: "Invitación enviada",
  INVITATION_RESENT: "Invitación reenviada",
  INVITATION_CANCELLED: "Invitación cancelada",
  SELLER_SUSPENDED: "Cuenta suspendida",
  SELLER_REACTIVATED: "Cuenta reactivada",
  SELLER_DISABLED: "Cuenta deshabilitada",
};

const SALE_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Borrador",
  PENDING: "Pendiente",
  SOLD: "Vendida",
  PAID: "Pagada",
};

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("es-DO", { dateStyle: "medium", timeStyle: "short" }).format(d);
}
function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("es-DO", { dateStyle: "medium" }).format(d);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border p-4 border-border bg-surface">
      <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
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

export default async function AdminSellerDetailPage({
  params,
}: {
  params: Promise<{ sellerId: string }>;
}) {
  const { sellerId } = await params;
  const detail = await getAdminSellerDetail(sellerId);
  if (!detail) notFound();

  const { profile, invitation, commercial, recentSales, recentEvents } = detail;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <Link href={ROUTES.adminVendedores} className="text-xs text-muted-foreground hover:text-foreground">
          ← Vendedores
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">{profile.fullName ?? "Sin nombre"}</h1>
          <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide border-border">
            {STATUS_LABEL[profile.accountStatus] ?? profile.accountStatus}
          </span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{profile.email}</p>
      </div>

      <Section title="Identidad">
        <div className="grid grid-cols-2 gap-3">
          <Fact label="Correo" value={profile.email ?? "—"} />
          <Fact label="Teléfono" value={profile.phone ?? "—"} />
          <Fact label="Fecha de alta" value={formatDate(profile.createdAt)} />
          <Fact
            label="Invitado"
            value={profile.invitedAt ? `${formatDate(profile.invitedAt)}${profile.invitedByName ? ` · por ${profile.invitedByName}` : ""}` : "—"}
          />
          {profile.accountStatus === "SUSPENDED" && (
            <>
              <Fact label="Suspendido" value={`${formatDateTime(profile.suspendedAt)}${profile.suspendedByName ? ` · ${profile.suspendedByName}` : ""}`} />
              <Fact label="Motivo" value={profile.suspensionReason ?? "—"} />
            </>
          )}
        </div>
      </Section>

      <Section title="Acciones">
        <SellerDetailActions sellerId={sellerId} accountStatus={profile.accountStatus} />
      </Section>

      <Section title="Resumen comercial">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Fact label="Pendientes" value={String(commercial.pendingCount)} />
          <Fact label="Vendidas" value={String(commercial.soldCount)} />
          <Fact label="Pagadas" value={String(commercial.paidCount)} />
          <Fact label="Unidades" value={String(commercial.unitsSold)} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 border-t pt-3 border-border">
          <Fact label="Ingresos (vendida + pagada)" value={formatCents(commercial.revenueCents)} />
          <div>
            <p className="text-[11px] text-muted-foreground">Comisión</p>
            <p className="mt-0.5 text-sm font-medium text-muted-foreground">Pendiente de configuración</p>
          </div>
        </div>
      </Section>

      <Section title="Ventas recientes">
        {recentSales.length === 0 ? (
          <p className="text-xs text-muted-foreground">Todavía no tiene ventas.</p>
        ) : (
          <ul className="space-y-2">
            {recentSales.map((s) => (
              <li key={s.saleId}>
                <Link
                  href={`${ROUTES.adminVentas}/${s.saleId}`}
                  className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm bg-surface-muted hover:bg-surface-elevated"
                >
                  <span>
                    <span className="font-medium">{s.saleNumber ?? "Sin número"}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{s.buyerName ?? "—"} · {SALE_STATUS_LABEL[s.status] ?? s.status}</span>
                  </span>
                  <span className="tabular-nums text-text-secondary">{formatCents(s.saleTotalCents)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Actividad reciente">
        {recentEvents.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Sin eventos registrados todavía. Acciones más finas (venta enviada a revisión, contrato firmado, etc.)
            se mostrarán aquí cuando exista el módulo global de auditoría.
          </p>
        ) : (
          <ul className="space-y-2">
            {recentEvents.map((e, i) => (
              <li key={i} className="flex items-center justify-between gap-2 text-xs">
                <span>
                  <span className="font-medium text-text-secondary">{EVENT_LABEL[e.eventType] ?? e.eventType}</span>
                  {e.actorName && <span className="text-muted-foreground"> · {e.actorName}</span>}
                  {e.reason && <span className="text-muted-foreground"> — {e.reason}</span>}
                </span>
                <span className="shrink-0 text-muted-foreground">{formatDateTime(e.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
        {invitation && (
          <p className="mt-3 border-t pt-2 text-[11px] text-muted-foreground border-border">
            Última invitación: {invitation.status} · {formatDateTime(invitation.invitedAt)}
          </p>
        )}
      </Section>
    </div>
  );
}
