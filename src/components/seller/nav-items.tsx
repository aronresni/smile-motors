import type { ReactNode } from "react";
import { ROUTES } from "@/lib/constants";
import {
  HomeIcon,
  MenuGridIcon,
  PercentIcon,
  PlusIcon,
  ReceiptIcon,
  type IconProps,
} from "@/components/seller/icons";

export interface SellerNavItem {
  key: string;
  label: string;
  href: string;
  Icon: (props: IconProps) => ReactNode;
  /** Acción primaria destacada (Nueva venta). */
  prominent?: boolean;
  /** El item queda activo también en sub-rutas de `href`. */
  matchNested?: boolean;
}

export const SELLER_NAV_ITEMS: SellerNavItem[] = [
  { key: "inicio", label: "Inicio", href: ROUTES.seller, Icon: HomeIcon },
  {
    key: "ventas",
    label: "Ventas",
    href: ROUTES.sellerVentas,
    Icon: ReceiptIcon,
    matchNested: true,
  },
  {
    key: "nueva",
    label: "Nueva venta",
    href: ROUTES.sellerVentaNueva,
    Icon: PlusIcon,
    prominent: true,
  },
  {
    key: "comisiones",
    label: "Comisiones",
    href: ROUTES.sellerComisiones,
    Icon: PercentIcon,
    matchNested: true,
  },
  { key: "menu", label: "Menú", href: ROUTES.sellerMenu, Icon: MenuGridIcon },
];

/** ¿`pathname` corresponde a este item de navegación? */
export function isNavItemActive(item: SellerNavItem, pathname: string): boolean {
  if (item.href === ROUTES.seller) return pathname === ROUTES.seller;
  if (item.href === ROUTES.sellerVentaNueva) {
    return pathname === ROUTES.sellerVentaNueva;
  }
  if (item.href === ROUTES.sellerVentas) {
    // "Ventas" no se activa en /seller/ventas/nueva (item propio).
    return (
      pathname === ROUTES.sellerVentas ||
      (pathname.startsWith(`${ROUTES.sellerVentas}/`) &&
        pathname !== ROUTES.sellerVentaNueva)
    );
  }
  if (item.matchNested) {
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
  }
  return pathname === item.href;
}
