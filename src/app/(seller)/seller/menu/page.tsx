import Link from "next/link";
import type { ReactNode } from "react";
import { requireZone } from "@/lib/auth/session";
import { deriveSellerIdentity } from "@/lib/seller/identity";
import { ROUTES } from "@/lib/constants";
import { BrandLogo } from "@/components/brand/brand-mark";
import { PageHeader } from "@/components/ui/page-header";
import { BellIcon, BoxesIcon, CalculatorIcon, ChevronRightIcon,
  LogOutIcon,
  PercentIcon,
  PlusIcon,
  ReceiptIcon,
  WalletIcon,
} from "@/components/ui/icons";
import { LogoutButton } from "@/components/auth/logout-button";

export const metadata = { title: "Menú" };

function MenuLink({ href, title, description, icon }: { href: string; title: string; description: string; icon: ReactNode }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 transition-colors hover:border-border-strong hover:bg-surface-muted active:scale-[0.99]"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">{title}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
      <ChevronRightIcon size={18} className="shrink-0 text-muted-foreground" />
    </Link>
  );
}

export default async function SellerMenuPage() {
  const { profile } = await requireZone("seller", ROUTES.sellerMenu);
  const me = deriveSellerIdentity(profile);

  return (
    <div className="space-y-5">
      <PageHeader title="Menú" description="Tu cuenta y accesos rápidos." />

      <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4">
        <BrandLogo size={48} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{me.fullName}</p>
          <p className="truncate text-xs text-muted-foreground">{me.email}</p>
        </div>
        <span className="rounded-full border border-brand/40 bg-brand-soft px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-brand">
          {me.roleLabel}
        </span>
      </div>

      <div className="space-y-2.5">
        <MenuLink href={ROUTES.sellerVentaNueva} title="Nueva venta" description="Registra una operación nueva." icon={<PlusIcon size={18} />} />
        <MenuLink href={ROUTES.sellerCalculadora} title="Calculadora" description="Simula precios, financiación y cuánto falta cubrir." icon={<CalculatorIcon size={18} />} />
        <MenuLink href={ROUTES.sellerStock} title="Stock" description="Catálogo de todo lo que se puede vender hoy." icon={<BoxesIcon size={18} />} />
        <MenuLink href={ROUTES.sellerVentas} title="Mis ventas" description="Borradores, pendientes, vendidas y pagadas." icon={<ReceiptIcon size={18} />} />
        <MenuLink href={ROUTES.sellerComisiones} title="Mis comisiones" description="Comisiones confirmadas, con el detalle de cada venta." icon={<PercentIcon size={18} />} />
        <MenuLink href={ROUTES.sellerLiquidaciones} title="Mis liquidaciones" description="Pagos semanales aprobados, con su detalle." icon={<WalletIcon size={18} />} />
        <MenuLink href={ROUTES.sellerNotificaciones} title="Notificaciones" description="Tus avisos y las notificaciones en el teléfono." icon={<BellIcon size={18} />} />
      </div>

      <LogoutButton className="flex w-full items-center justify-center gap-2 rounded-2xl border border-border-strong bg-surface px-4 py-3.5 text-sm font-semibold text-text-secondary transition-colors hover:bg-surface-elevated hover:text-foreground">
        <LogOutIcon size={17} />
        Cerrar sesión
      </LogoutButton>
    </div>
  );
}
