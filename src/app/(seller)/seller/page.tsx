import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth";
import { ROUTES } from "@/lib/constants";
import { deriveSellerIdentity } from "@/lib/seller/identity";
import { getSellerDashboardData } from "@/lib/seller/dashboard-data";
import { defaultPeriod, resolveRange } from "@/lib/seller/period";
import { SellerDashboard } from "@/components/seller/dashboard/seller-dashboard";

export const metadata: Metadata = { title: "Mi panel · Vendedor" };

export default async function SellerHomePage() {
  // El layout ya valida sesión + rol; este guard extra tipa `ctx` como no-nulo.
  const ctx = await getAuthContext();
  if (!ctx) redirect(ROUTES.login);

  const period = defaultPeriod();
  const data = await getSellerDashboardData(resolveRange(period));

  return (
    <SellerDashboard
      seller={deriveSellerIdentity(ctx.profile)}
      initialPeriod={period}
      initialData={data}
    />
  );
}
