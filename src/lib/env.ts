import { z } from 'zod'

/**
 * Validación de variables de entorno en el arranque (fail-fast).
 * Si falta algo o tiene mal formato, la app no levanta y el error es claro.
 *
 * Las `NEXT_PUBLIC_*` se leen de forma estática (una por una) para que Next.js
 * pueda inyectarlas en el bundle del navegador en build time.
 */
const EnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .url('NEXT_PUBLIC_SUPABASE_URL debe ser una URL válida'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(1, 'NEXT_PUBLIC_SUPABASE_ANON_KEY es obligatoria'),
  NEXT_PUBLIC_SITE_URL: z
    .string()
    .url('NEXT_PUBLIC_SITE_URL debe ser una URL válida')
    .default('http://localhost:3000'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  DATABASE_URL: z.string().min(1).optional(),
})

/** Trata "" (variable declarada pero vacía) como ausente. */
const clean = (value: string | undefined) =>
  value === undefined || value.trim() === '' ? undefined : value

const parsed = EnvSchema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: clean(process.env.NEXT_PUBLIC_SUPABASE_URL),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  NEXT_PUBLIC_SITE_URL: clean(process.env.NEXT_PUBLIC_SITE_URL),
  SUPABASE_SERVICE_ROLE_KEY: clean(process.env.SUPABASE_SERVICE_ROLE_KEY),
  DATABASE_URL: clean(process.env.DATABASE_URL),
})

if (!parsed.success) {
  console.error(
    '❌ Variables de entorno inválidas:\n',
    JSON.stringify(parsed.error.flatten().fieldErrors, null, 2),
  )
  throw new Error('Variables de entorno inválidas. Revisa tu archivo .env.local')
}

export const env = parsed.data
export type Env = typeof env
