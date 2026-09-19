"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  SELLER_NAV_ITEMS,
  isNavItemActive,
} from "@/components/seller/nav-items";

/**
 * Navegación inferior persistente (móvil / tablet).
 * Tratamiento propio: barra flotante con blur, borde superior sutil y la acción
 * "Nueva venta" como tarjeta ámbar elevada en el centro. Sin círculo rojo.
 */
export function SellerBottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navegación del vendedor"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-background/90 backdrop-blur lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex w-full max-w-lg items-stretch justify-between gap-1 px-2 pt-1.5 pb-1.5">
        {SELLER_NAV_ITEMS.map((item) => {
          const active = isNavItemActive(item, pathname);
          const { Icon } = item;

          if (item.prominent) {
            return (
              <li key={item.key} className="flex flex-1 justify-center">
                <Link
                  href={item.href}
                  prefetch
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "-mt-4 flex w-full max-w-[92px] flex-col items-center gap-1 rounded-2xl px-2 py-2 text-[11px] font-semibold shadow-lg shadow-black/25 transition-transform active:scale-95",
                    "bg-accent text-accent-foreground",
                    active && "ring-2 ring-accent/40",
                  )}
                >
                  <Icon size={22} />
                  <span className="leading-none">{item.label}</span>
                </Link>
              </li>
            );
          }

          return (
            <li key={item.key} className="flex flex-1">
              <Link
                href={item.href}
                prefetch
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex w-full flex-col items-center gap-1 rounded-xl px-1 py-1.5 text-[11px] transition-colors",
                  active
                    ? "text-accent"
                    : "text-muted-foreground hover:text-text-secondary",
                )}
              >
                <Icon size={20} />
                <span className="leading-none">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
