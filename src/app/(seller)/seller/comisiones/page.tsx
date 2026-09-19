import type { Metadata } from "next";
import { requireZone } from "@/lib/auth/session";
import {
  getSellerCommissionKpis,
  getSellerCommissionList,
} from "@/lib/seller/commissions";
import { SellerCommissionKpiCards } from "@/components/seller/comisiones/seller-commission-kpis";
import { SellerCommissionList } from "@/components/seller/comisiones/seller-commission-list";

export const metadata: Metadata = { title: "Mis comisiones · Vendedor" };

// Zona protegida: nunca cachear.
export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;

export default async function SellerComisionesPage() {
  // Defensa en profundidad (el layout ya valida sesión + rol).
  await requireZone("seller");

  const [kpis, { items, total }] = await Promise.all([
    getSellerCommissionKpis(),
    getSellerCommissionList(PAGE_SIZE, 0),
  ]);

  return (
    <div className="space-y-4 sm:space-y-5">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">
          Mis comisiones
        </p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          Comisión por venta
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Se calcula una vez al confirmar cada venta como Vendida y queda elegible cuando la venta se paga.
        </p>
      </div>

      <SellerCommissionKpiCards kpis={kpis} />

      <SellerCommissionList items={items} />

      {items.length > 0 && (
        <p className="text-center text-[11px] text-muted-foreground">
          Mostrando {items.length} de {total}
        </p>
      )}
    </div>
  );
}
