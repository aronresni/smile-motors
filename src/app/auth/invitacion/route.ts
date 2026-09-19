import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ROUTES } from "@/lib/constants";

/**
 * Entrada del enlace de invitación (ver `lib/auth/invite-link.ts`): canjea en
 * el SERVIDOR el token de un solo uso por la sesión temporal (cookies) y
 * lleva a la pantalla donde la persona crea su contraseña.
 *
 * Se hace aquí, y no con el enlace de correo de Supabase, porque aquel
 * devuelve la sesión en el fragmento `#access_token=…` (invisible para el
 * servidor) y siempre hacia el "Site URL" del proyecto.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");

  if (tokenHash) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type: "invite", token_hash: tokenHash });
    if (!error) {
      return NextResponse.redirect(`${origin}${ROUTES.authAcceptInvite}`);
    }
  }

  // Token ausente, ya usado o caducado: al login con un mensaje claro.
  return NextResponse.redirect(`${origin}${ROUTES.login}?error=invite_invalid`);
}
