import {
  ADMIN_CAN_ACCESS_SELLER,
  ROLES,
  ROLE_HOME,
  ROUTES,
  type Role,
} from "@/lib/constants";

export type Zone = "seller" | "admin";

/** Zona operativa a la que pertenece un pathname, o null si es público/neutro. */
export function zoneOf(pathname: string): Zone | null {
  if (pathname === ROUTES.seller || pathname.startsWith(`${ROUTES.seller}/`)) {
    return "seller";
  }
  if (pathname === ROUTES.admin || pathname.startsWith(`${ROUTES.admin}/`)) {
    return "admin";
  }
  return null;
}

/** ¿El rol tiene permiso para entrar a esta zona? */
export function canAccessZone(role: Role, zone: Zone): boolean {
  if (role === ROLES.ADMIN) {
    return zone === "admin" || ADMIN_CAN_ACCESS_SELLER;
  }
  if (role === ROLES.SELLER) {
    return zone === "seller";
  }
  return false;
}

/** Ruta de inicio del rol. */
export function homeForRole(role: Role): string {
  return ROLE_HOME[role] ?? ROUTES.login;
}

/**
 * Destino seguro tras iniciar sesión: respeta `redirectTo` solo si es una ruta
 * interna y el rol puede acceder a esa zona; si no, la home del rol.
 * Evita open-redirects y saltos de zona.
 */
export function safeRedirect(role: Role, redirectTo: string | null): string {
  if (
    redirectTo &&
    redirectTo.startsWith("/") &&
    !redirectTo.startsWith("//")
  ) {
    const zone = zoneOf(redirectTo);
    if (zone && canAccessZone(role, zone)) return redirectTo;
  }
  return homeForRole(role);
}
