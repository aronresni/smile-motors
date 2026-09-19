import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * KPIs operativos del panel de administración — `admin_dashboard_data`
 * (verifica `is_admin()` server-side; la RLS de `sales`/`sale_payment_allocations`/
 * `sale_financing_contracts` también lo permite). Todo calculado en vivo en
 * la base — nunca se descarga el histórico completo al navegador.
 */
export interface AdminDashboardData {
  pendingCount: number;
  soldCount: number;
  pendingCollectionCount: number;
  readyToPayCount: number;
  paidCount: number;
  outstandingAmountCents: number;
  /** Suma de `sale_total_cents` de ventas PAGADAS cuyo `paid_at` cae en el período pedido. */
  paidAmountCentsPeriod: number;
}

const EMPTY: AdminDashboardData = {
  pendingCount: 0,
  soldCount: 0,
  pendingCollectionCount: 0,
  readyToPayCount: 0,
  paidCount: 0,
  outstandingAmountCents: 0,
  paidAmountCentsPeriod: 0,
};

export async function getAdminDashboardData(
  startISO: string,
  endISO: string,
): Promise<AdminDashboardData> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_dashboard_data", {
    p_start: startISO,
    p_end: endISO,
  });
  if (error || !data) return EMPTY;

  const res = data as unknown as { ok: boolean } & Partial<AdminDashboardData>;
  if (!res.ok) return EMPTY;

  return {
    pendingCount: res.pendingCount ?? 0,
    soldCount: res.soldCount ?? 0,
    pendingCollectionCount: res.pendingCollectionCount ?? 0,
    readyToPayCount: res.readyToPayCount ?? 0,
    paidCount: res.paidCount ?? 0,
    outstandingAmountCents: res.outstandingAmountCents ?? 0,
    paidAmountCentsPeriod: res.paidAmountCentsPeriod ?? 0,
  };
}
