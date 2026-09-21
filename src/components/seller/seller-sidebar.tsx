"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { ROUTES } from "@/lib/constants";
import { BrandMark } from "@/components/brand/brand-mark";
import {
  SELLER_NAV_ITEMS,
  isNavItemActive,
} from "@/components/seller/nav-items";
import { CalculatorIcon, LogOutIcon, PercentIcon, WalletIcon } from "@/components/ui/icons";
import { LogoutButton } from "@/components/auth/logout-button";

/** Accesos extra solo en escritorio (en móvil viven en "Menú"). */
const EXTRA_GROUPS = [
  {
    title: "Herramientas",
    items: [{ href: ROUTES.sellerCalculadora, label: "Calculadora", Icon: CalculatorIcon }],
  },
  {
    title: "Mis pagos",
    items: [
      { href: ROUTES.sellerComisiones, label: "Mis comisiones", Icon: PercentIcon },
      { href: ROUTES.sellerLiquidaciones, label: "Mis liquidaciones", Icon: WalletIcon },
    ],
  },
];

/** Riel de navegación lateral (escritorio). Contrapartida de la barra inferior. */
export function SellerSidebar() {
  const pathname = usePathname();

  const linkClass = (active: boolean, prominent?: boolean) =>
    cn(
      "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
      prominent && !active && "border border-brand/35 bg-brand-soft font-semibold text-brand hover:bg-brand/20",
      active && prominent && "bg-brand font-semibold text-brand-foreground",
      active && !prominent && "bg-brand-soft font-semibold text-foreground",
      !active && !prominent && "text-text-secondary hover:bg-surface-elevated hover:text-foreground",
    );

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-border bg-surface lg:flex">
      <Link
        href={ROUTES.seller}
        className="flex items-center border-b border-border px-5 py-4 transition-opacity hover:opacity-90"
        aria-label="Smile Motors — Inicio"
      >
        <BrandMark roleLabel="Vendedor" size={44} priority />
      </Link>

      <nav aria-label="Navegación del vendedor" className="flex-1 overflow-y-auto px-3 py-5">
        <ul className="space-y-1">
          {SELLER_NAV_ITEMS.map((item) => {
            const active = isNavItemActive(item, pathname);
            const { Icon } = item;
            return (
              <li key={item.key}>
                <Link
                  href={item.href}
                  prefetch
                  aria-current={active ? "page" : undefined}
                  className={linkClass(active, item.prominent)}
                >
                  {active && !item.prominent && (
                    <span aria-hidden="true" className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-brand" />
                  )}
                  <Icon size={19} className={cn(active && !item.prominent && "text-brand")} />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>

        {EXTRA_GROUPS.map((group) => (
          <div key={group.title}>
            <p className="mb-1.5 mt-6 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">
              {group.title}
            </p>
            <ul className="space-y-1">
              {group.items.map(({ href, label, Icon }) => {
                const active = pathname === href || pathname.startsWith(`${href}/`);
                return (
                  <li key={href}>
                    <Link href={href} aria-current={active ? "page" : undefined} className={linkClass(active)}>
                      {active && (
                        <span aria-hidden="true" className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-brand" />
                      )}
                      <Icon size={19} className={cn(active ? "text-brand" : "text-muted-foreground")} />
                      {label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-border px-3 py-3">
        <LogoutButton className="flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-elevated hover:text-foreground">
          <LogOutIcon size={16} />
          Cerrar sesión
        </LogoutButton>
      </div>
    </aside>
  );
}
