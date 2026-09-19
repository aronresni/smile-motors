import type { ReactNode } from "react";
import { requireZone } from "@/lib/auth/session";
import { BfcacheGuard } from "@/components/auth/bfcache-guard";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { AdminHeader } from "@/components/admin/admin-header";
import { ROUTES } from "@/lib/constants";
import { getApprovalsCounts } from "@/lib/admin/approvals";
import { getAlertsSummary } from "@/lib/admin/alerts";

// Nunca cachear una zona protegida.
export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  // 2.º nivel de protección (además del proxy): valida sesión + rol en servidor.
  const { profile } = await requireZone("admin", ROUTES.admin);
  // Conteos de los badges "Aprobaciones"/"Alertas" — renderizados por
  // servidor en cada navegación (layout dinámico), sin sondeo desde el
  // cliente. Son conteos independientes (Alertas incluye internamente los
  // mismos 4 tipos de Aprobaciones, pero cada badge muestra su propio total).
  const [counts, alerts] = await Promise.all([getApprovalsCounts(), getAlertsSummary()]);

  return (
    <div className="min-h-svh bg-background text-foreground">
      <BfcacheGuard />
      <AdminSidebar approvalsCount={counts.totalPending} alertsCount={alerts.total} />
      <div className="lg:pl-64">
        <AdminHeader
          fullName={profile.full_name}
          email={profile.email}
          approvalsCount={counts.totalPending}
          alertsCount={alerts.total}
        />
        <main
          className="mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7"
          style={{ paddingBottom: "max(2rem, env(safe-area-inset-bottom))" }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
