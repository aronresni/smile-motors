import type { Metadata } from "next";
import { requireZone } from "@/lib/auth/session";
import { getSellerLiquidationList } from "@/lib/seller/liquidations";
import { SellerLiquidationList } from "@/components/seller/liquidaciones/seller-liquidation-list";

export const metadata: Metadata = { title: "Mis liquidaciones · Vendedor" };
export const dynamic = "force-dynamic";

export default async function SellerLiquidacionesPage() {
  await requireZone("seller");
  const items = await getSellerLiquidationList();

  return (
    <div className="space-y-4 sm:space-y-5">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">Mis liquidaciones</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">Pagos semanales</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Una liquidación agrupa tus comisiones ya elegibles de una semana, una vez que el admin la aprueba.
        </p>
      </div>

      <SellerLiquidationList items={items} />
    </div>
  );
}
