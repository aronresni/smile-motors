import Link from "next/link";
import { BrandLogo } from "@/components/brand/brand-mark";
import { ROUTES } from "@/lib/constants";
import type { SellerIdentity } from "@/lib/seller/identity";

interface SellerHeaderProps {
  seller: SellerIdentity;
  dealerName: string;
  greeting: string;
}

/**
 * Cabecera del vendedor. En móvil lleva el logo oficial (el riel lateral solo
 * existe en escritorio). El avatar abre "Menú" (perfil, pagos, cerrar sesión).
 * Sin campana de notificaciones: no existe backend de notificaciones y un
 * botón que no hace nada sería engañoso.
 */
export function SellerHeader({ seller, dealerName, greeting }: SellerHeaderProps) {
  return (
    <header
      className="sticky top-0 z-30 border-b border-border/70 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-3 lg:px-8">
        <Link href={ROUTES.seller} aria-label="Smile Motors — Inicio" className="shrink-0 lg:hidden">
          <BrandLogo size={40} priority />
        </Link>

        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-xs text-muted-foreground">{greeting},</p>
          <p className="truncate text-sm font-semibold text-foreground">{seller.firstName}</p>
          <p className="truncate text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            {seller.roleLabel} · {dealerName}
          </p>
        </div>

        <Link
          href={ROUTES.sellerMenu}
          aria-label="Abrir menú de cuenta"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-border-strong bg-surface-elevated text-sm font-bold tracking-wide text-brand transition-colors hover:border-brand/50"
        >
          {seller.initials}
        </Link>
      </div>
    </header>
  );
}
