import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { AUTH_ROUTES, ROLES, ROUTES, type Role } from "@/lib/constants";
import { canAccessZone, homeForRole, zoneOf } from "@/lib/auth/access";

/**
 * "Proxy" = lo que en Next.js <= 15 se llamaba Middleware (renombrado en v16).
 * Es el PRIMER nivel de protección de rutas (defensa en profundidad; los
 * layouts de `(seller)` y `(admin)` vuelven a validar en el servidor, y RLS
 * protege los datos en la base).
 *
 * Reglas:
 *  1. Refresca la sesión de Supabase en cada request.
 *  2. Zona protegida (/seller/*, /admin/*) sin sesión  → /login?redirectTo=...
 *  3. Sesión sin perfil activo                          → /login?error=no_access
 *  4. Rol sin permiso para la zona                      → home del rol
 *  5. Usuario ya logueado entrando a /login (etc.)      → home del rol
 *  6. Respuestas de zona protegida → `Cache-Control: no-store` (evita ver
 *     páginas cerradas con el botón "atrás").
 */

const NO_STORE = "no-store, no-cache, must-revalidate, proxy-revalidate";

function withNoStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", NO_STORE);
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
}

/** Redirección que conserva las cookies de sesión ya refrescadas. */
function redirectWithSession(
  url: URL,
  base: NextResponse,
  noStore = true,
): NextResponse {
  const response = NextResponse.redirect(url);
  base.cookies.getAll().forEach((cookie) => response.cookies.set(cookie));
  return noStore ? withNoStore(response) : response;
}

export async function proxy(request: NextRequest) {
  const { supabaseResponse, user, supabase } = await updateSession(request);
  const { pathname } = request.nextUrl;

  const zone = zoneOf(pathname);
  const isAuthRoute = AUTH_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );

  // --- 2..4: Zona protegida ------------------------------------------------
  if (zone) {
    if (!user) {
      const url = request.nextUrl.clone();
      url.pathname = ROUTES.login;
      url.search = "";
      url.searchParams.set("redirectTo", pathname);
      return redirectWithSession(url, supabaseResponse);
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, is_active")
      .eq("id", user.id)
      .single();

    const role = profile?.role as Role | undefined;
    const roleIsKnown = role === ROLES.ADMIN || role === ROLES.SELLER;

    if (!profile || !profile.is_active || !roleIsKnown) {
      const url = request.nextUrl.clone();
      url.pathname = ROUTES.login;
      url.search = "";
      url.searchParams.set("error", "no_access");
      return redirectWithSession(url, supabaseResponse);
    }

    if (!canAccessZone(role, zone)) {
      const url = request.nextUrl.clone();
      url.pathname = homeForRole(role);
      url.search = "";
      return redirectWithSession(url, supabaseResponse);
    }

    return withNoStore(supabaseResponse);
  }

  // --- 5: Usuario logueado que abre una ruta de auth ---------------------
  // Solo navegaciones (GET/HEAD). Un POST a /login es el envío del formulario
  // (Server Action): redirigirlo con 307 lo reenviaría como POST a /seller o
  // /admin, donde esa acción no existe ("unexpected response"). Pasa cuando
  // la pestaña quedó en /login con una sesión que ya es válida (p. ej. tras
  // un corte de red momentáneo con Supabase); la propia acción de login
  // vuelve a autenticar y redirige a la zona del rol.
  const isNavigation = request.method === "GET" || request.method === "HEAD";
  if (isAuthRoute && user && isNavigation) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, is_active")
      .eq("id", user.id)
      .single();

    const role = profile?.role as Role | undefined;
    if ((role === ROLES.ADMIN || role === ROLES.SELLER) && profile?.is_active) {
      const url = request.nextUrl.clone();
      url.pathname = homeForRole(role);
      url.search = "";
      return redirectWithSession(url, supabaseResponse, false);
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Todas las rutas salvo:
     *  - _next/static, _next/image
     *  - favicon.ico
     *  - archivos de imagen estáticos
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
