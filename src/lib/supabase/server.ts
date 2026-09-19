import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { env } from "@/lib/env";
import {
  PERSIST_COOKIE,
  PERSIST_OFF,
  withSessionPersistence,
} from "@/lib/supabase/cookies";
import type { Database } from "@/types/database.types";

/**
 * Cliente de Supabase para el SERVIDOR (Server Components, Server Actions,
 * Route Handlers). Lee/escribe la sesión en cookies.
 *
 * En Next.js 16 `cookies()` es asíncrono, por eso esta función es `async`.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            const persistent =
              cookieStore.get(PERSIST_COOKIE)?.value !== PERSIST_OFF;
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(
                name,
                value,
                withSessionPersistence(options, persistent),
              ),
            );
          } catch {
            // Se llamó desde un Server Component: se puede ignorar siempre que
            // `src/proxy.ts` esté refrescando la sesión en cada request.
          }
        },
      },
    },
  );
}
