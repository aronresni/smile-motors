import { createBrowserClient } from '@supabase/ssr'
import { env } from '@/lib/env'
import type { Database } from '@/types/database.types'

/**
 * Cliente de Supabase para el NAVEGADOR (Client Components).
 * Usa solo la clave anon; el acceso a datos lo restringe RLS.
 */
export function createClient() {
  return createBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  )
}
