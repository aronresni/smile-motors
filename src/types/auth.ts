import type { User } from "@supabase/supabase-js";
import type { Role } from "@/lib/constants";

/** Fila de `public.profiles` con el `role` ya tipado como Role. */
export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  role: Role;
  is_active: boolean;
}

/** Usuario de Supabase enriquecido con el rol de la app. */
export type SessionUser = User & {
  role?: Role;
};

export interface AuthActionResult {
  ok: boolean;
  error?: string;
}
