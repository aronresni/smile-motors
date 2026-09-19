import type { SellerIdentity } from "@/lib/seller/identity";

export function DashboardIntro({ seller }: { seller: SellerIdentity }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand">
        Smile Motors · Mi panel
      </p>
      <h1 className="mt-1 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
        Resumen comercial
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Tu actividad y rendimiento de ventas, {seller.firstName}.
      </p>
    </div>
  );
}
