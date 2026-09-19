"use server";

import { requireZone } from "@/lib/auth/session";
import { getSellerDashboardData } from "@/lib/seller/dashboard-data";
import { resolveRange, type Period } from "@/lib/seller/period";
import type { SellerDashboardData } from "@/lib/seller/types";

/**
 * Recarga los datos del panel para un período. Revalida sesión + rol en el
 * servidor (no confía en el cliente). Hoy devuelve el dataset vacío; cuando
 * exista el backend, esta es la única puerta de entrada de datos del panel.
 */
export async function loadDashboard(
  period: Period,
): Promise<SellerDashboardData> {
  // Revalida sesión + rol; el propio vendedor lo resuelve la RPC vía auth.uid().
  await requireZone("seller");
  return getSellerDashboardData(resolveRange(period));
}
