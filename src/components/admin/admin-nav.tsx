"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ROUTES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import {
  ActivityIcon,
  AlertTriangleIcon,
  BankIcon,
  ChartBarIcon,
  CheckCircleIcon,
  DashboardIcon,
  PackageIcon,
  PercentIcon,
  ReceiptIcon,
  TruckIcon,
  UsersIcon,
  WalletIcon,
  type IconProps,
} from "@/components/ui/icons";

export interface AdminNavItem {
  href: string;
  label: string;
  Icon: (p: IconProps) => ReactNode;
  badge?: "approvals" | "alerts";
}
export interface AdminNavGroup {
  label: string | null;
  items: AdminNavItem[];
}

/** Navegación del Admin — agrupada por intención, siempre con texto. */
export const ADMIN_NAV: AdminNavGroup[] = [
  { label: null, items: [{ href: ROUTES.admin, label: "Panel", Icon: DashboardIcon }] },
  {
    label: "Operación",
    items: [
      { href: ROUTES.adminVentas, label: "Ventas", Icon: ReceiptIcon },
      { href: ROUTES.adminAprobaciones, label: "Aprobaciones", Icon: CheckCircleIcon, badge: "approvals" },
      { href: ROUTES.adminAlertas, label: "Alertas", Icon: AlertTriangleIcon, badge: "alerts" },
      { href: ROUTES.adminLogistica, label: "Logística", Icon: TruckIcon },
    ],
  },
  {
    label: "Catálogo",
    items: [
      { href: ROUTES.adminProductos, label: "Productos", Icon: PackageIcon },
      { href: ROUTES.adminFinancieras, label: "Financieras", Icon: BankIcon },
    ],
  },
  {
    label: "Equipo y pagos",
    items: [
      { href: ROUTES.adminVendedores, label: "Vendedores", Icon: UsersIcon },
      { href: ROUTES.adminComisiones, label: "Comisiones", Icon: PercentIcon },
      { href: ROUTES.adminLiquidaciones, label: "Liquidaciones", Icon: WalletIcon },
    ],
  },
  {
    label: "Análisis",
    items: [
      { href: ROUTES.adminActividad, label: "Actividad", Icon: ActivityIcon },
      { href: ROUTES.adminReportes, label: "Reportes", Icon: ChartBarIcon },
    ],
  },
];

export function isAdminNavActive(href: string, pathname: string): boolean {
  if (href === ROUTES.admin) return pathname === ROUTES.admin;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Título de contexto para la cabecera, derivado de la ruta actual. */
export function adminSectionLabel(pathname: string): string {
  if (pathname === ROUTES.adminNotificaciones || pathname.startsWith(`${ROUTES.adminNotificaciones}/`)) {
    return "Notificaciones";
  }
  for (const g of ADMIN_NAV) {
    for (const it of g.items) {
      if (it.href !== ROUTES.admin && isAdminNavActive(it.href, pathname)) return it.label;
    }
  }
  return "Panel";
}

/**
 * Lista de navegación (sidebar de escritorio y drawer móvil). Los conteos de
 * "Aprobaciones" y "Alertas" llegan calculados server-side (sin polling) y son
 * INDEPENDIENTES: Alertas incluye los 4 tipos de Aprobaciones en su total,
 * pero cada badge muestra su propio número — nunca uno combinado.
 */
export function AdminNav({
  approvalsCount,
  alertsCount,
  onNavigate,
}: {
  approvalsCount?: number;
  alertsCount?: number;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  return (
    <nav aria-label="Navegación de administración" className="space-y-5">
      {ADMIN_NAV.map((group, gi) => (
        <div key={gi}>
          {group.label && (
            <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">
              {group.label}
            </p>
          )}
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = isAdminNavActive(item.href, pathname);
              const count =
                item.badge === "approvals" ? approvalsCount : item.badge === "alerts" ? alertsCount : undefined;
              const { Icon } = item;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors",
                      active
                        ? "bg-brand-soft font-semibold text-foreground"
                        : "text-text-secondary hover:bg-surface-elevated hover:text-foreground",
                    )}
                  >
                    {active && (
                      <span aria-hidden="true" className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-brand" />
                    )}
                    <Icon size={18} className={cn("shrink-0", active ? "text-brand" : "text-muted-foreground group-hover:text-text-secondary")} />
                    <span className="flex-1 truncate">{item.label}</span>
                    {Boolean(count) && (
                      <span
                        className={cn(
                          "inline-flex min-w-[20px] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none",
                          item.badge === "alerts" ? "bg-danger text-white" : "bg-brand text-brand-foreground",
                        )}
                        aria-label={`${count} pendientes`}
                      >
                        {count}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
