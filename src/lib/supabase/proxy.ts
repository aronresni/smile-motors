import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { env } from "@/lib/env";
import {
  PERSIST_COOKIE,
  PERSIST_OFF,
  withSessionPersistence,
} from "@/lib/supabase/cookies";
import type { Database } from "@/types/database.types";

/**
 * Refresca la sesión de Supabase en cada request. Devuelve:
 *  - `supabaseResponse`: respuesta con las cookies de sesión actualizadas.
 *  - `user`: usuario verificado (o null).
 *  - `supabase`: el cliente, por si el proxy necesita leer `profiles` (rol).
 *
 * Se invoca desde `src/proxy.ts` (lo que en Next.js <= 15 era `middleware.ts`).
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          const persistent =
            request.cookies.get(PERSIST_COOKIE)?.value !== PERSIST_OFF;
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(
              name,
              value,
              withSessionPersistence(options, persistent),
            ),
          );
        },
      },
    },
  );

  // IMPORTANTE: no metas lógica entre createServerClient y getUser().
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { supabaseResponse, user, supabase };
}
