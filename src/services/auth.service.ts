import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { env } from '@/lib/env'
import { ROUTES } from '@/lib/constants'
import type { LoginInput, RegisterInput } from '@/validations'

/**
 * Capa de acceso a datos de autenticación.
 * Todo aquí corre en el SERVIDOR (Server Components / Server Actions / Route Handlers).
 * Los componentes de cliente deben pasar por Server Actions, no importar esto.
 */

export async function getCurrentUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}

export async function signInWithPassword(input: LoginInput) {
  const supabase = await createClient()
  return supabase.auth.signInWithPassword(input)
}

export async function signUpWithPassword(input: RegisterInput) {
  const supabase = await createClient()
  return supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      data: { full_name: input.fullName },
      emailRedirectTo: `${env.NEXT_PUBLIC_SITE_URL}${ROUTES.authCallback}`,
    },
  })
}

export async function sendPasswordReset(email: string) {
  const supabase = await createClient()
  return supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${env.NEXT_PUBLIC_SITE_URL}${ROUTES.resetPassword}`,
  })
}

export async function signOut() {
  const supabase = await createClient()
  return supabase.auth.signOut()
}
