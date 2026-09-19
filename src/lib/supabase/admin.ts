import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import type { Database } from "@/types/database.types";

/**
 * Cliente con la clave `service_role`. IGNORA RLS — acceso total.
 * SOLO SERVIDOR. Usar exclusivamente en scripts/seeds/tareas administrativas,
 * nunca en respuesta directa a una petición de un usuario sin comprobar permisos.
 * La clave nunca debe llegar al navegador.
 */
export function createAdminClient() {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY no está configurada; el cliente admin no está disponible.",
    );
  }

  return createSupabaseClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
