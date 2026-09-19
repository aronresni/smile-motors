import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ROUTES } from "@/lib/constants";

/**
 * Cierre de sesión. Termina la sesión de Supabase (borra las cookies de auth)
 * y redirige a /login. `no-store` evita que el navegador sirva páginas
 * protegidas desde caché tras el logout.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  const response = NextResponse.redirect(new URL(ROUTES.login, request.url), {
    status: 303,
  });
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  return response;
}
