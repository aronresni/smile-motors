export const APP_NAME = "Smile Motors";

/** Roles de usuario. Se materializan en `public.profiles.role`. */
export const ROLES = {
  ADMIN: "admin",
  SELLER: "seller",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

/** Rutas centralizadas para evitar strings sueltos por el código. */
export const ROUTES = {
  home: "/",
  login: "/login",
  register: "/register",
  forgotPassword: "/forgot-password",
  resetPassword: "/reset-password",
  authCallback: "/auth/callback",
  signOut: "/auth/signout",
  seller: "/seller",
  sellerVentas: "/seller/ventas",
  sellerVentaNueva: "/seller/ventas/nueva",
  sellerVentaNuevaCuba: "/seller/ventas/nueva/cuba",
  sellerVentaNuevaUsa: "/seller/ventas/nueva/usa",
  sellerMenu: "/seller/menu",
  sellerComisiones: "/seller/comisiones",
  sellerLiquidaciones: "/seller/liquidaciones",
  sellerNotificaciones: "/seller/notificaciones",
  admin: "/admin",
  adminVentas: "/admin/ventas",
  adminVendedores: "/admin/vendedores",
  adminFinancieras: "/admin/financieras",
  adminProductos: "/admin/productos",
  adminAprobaciones: "/admin/aprobaciones",
  adminComisiones: "/admin/comisiones",
  adminLiquidaciones: "/admin/liquidaciones",
  adminActividad: "/admin/actividad",
  adminAlertas: "/admin/alertas",
  adminReportes: "/admin/reportes",
  adminLogistica: "/admin/logistica",
  adminNotificaciones: "/admin/notificaciones",
  adminPerfil: "/admin/perfil",
  authAcceptInvite: "/auth/accept-invite",
  /** Enlace que recibe la persona invitada (canjea el token y pide contraseña). */
  authInvite: "/auth/invitacion",
} as const;

/** Prefijos de ruta que exigen sesión + rol (zonas operativas). */
export const PROTECTED_PREFIXES = [ROUTES.seller, ROUTES.admin] as const;

/** Rutas de autenticación: un usuario ya logueado no debería verlas. */
export const AUTH_ROUTES = [
  ROUTES.login,
  ROUTES.register,
  ROUTES.forgotPassword,
  ROUTES.resetPassword,
] as const;

/** A dónde va cada rol tras iniciar sesión. */
export const ROLE_HOME: Record<Role, string> = {
  [ROLES.ADMIN]: ROUTES.admin,
  [ROLES.SELLER]: ROUTES.seller,
};

/**
 * Política EXPLÍCITA: ¿un ADMIN autenticado puede entrar a las rutas /seller/*?
 *   true  → sí (admin es superconjunto y puede ver las pantallas del vendedor).
 *   false → separación estricta; un admin en /seller/* se redirige a /admin.
 */
export const ADMIN_CAN_ACCESS_SELLER = true;
