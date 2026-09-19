"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PERSIST_COOKIE, PERSIST_OFF } from "@/lib/supabase/cookies";
import { loginSchema } from "@/validations";
import { safeRedirect } from "@/lib/auth/access";
import { ROLES, type Role } from "@/lib/constants";

/** Mensajes que ve el usuario. Nunca se expone el error crudo de Supabase. */
const MESSAGES = {
  invalid: "El correo electrónico o la contraseña son incorrectos.",
  inactive: "Tu cuenta no está habilitada. Contacta a un administrador.",
  network: "No pudimos conectarnos. Intenta nuevamente.",
  unexpected: "Ocurrió un error al iniciar sesión.",
} as const;

export interface LoginState {
  error: string | null;
  fieldErrors?: {
    email?: string;
    password?: string;
  };
}

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return {
      error: null,
      fieldErrors: {
        email: fieldErrors.email?.[0],
        password: fieldErrors.password?.[0],
      },
    };
  }

  const email = parsed.data.email.trim().toLowerCase();
  const password = parsed.data.password;

  // "Mantener sesión iniciada": si NO se marca, las cookies de Supabase pasan a
  // ser cookies de sesión del navegador (ver lib/supabase/cookies.ts).
  const remember = formData.get("remember") === "on";
  const cookieStore = await cookies();
  if (remember) {
    cookieStore.delete(PERSIST_COOKIE);
  } else {
    cookieStore.set(PERSIST_COOKIE, PERSIST_OFF, {
      path: "/",
      sameSite: "lax",
    });
  }

  const supabase = await createClient();

  let result: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>;
  try {
    result = await supabase.auth.signInWithPassword({ email, password });
  } catch (cause) {
    console.error("[login] error de red o inesperado en signInWithPassword", cause instanceof Error ? cause.message : "desconocido");
    return { error: MESSAGES.network };
  }

  if (result.error || !result.data.user) {
    if (process.env.NODE_ENV !== "production") {
      // Solo código/estado: nunca el objeto de error (ni datos del usuario).
      console.error("[login] signInWithPassword falló", result.error?.code ?? "sin_codigo", result.error?.status ?? 0);
    }
    const status = result.error?.status ?? 0;
    return { error: status >= 500 ? MESSAGES.unexpected : MESSAGES.invalid };
  }

  // Perfil interno: fuente confiable del rol y del estado de la cuenta.
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role, is_active")
    .eq("id", result.data.user.id)
    .single();

  if (profileError || !profile) {
    console.error("[login] no se pudo leer el perfil", profileError?.code ?? "sin_perfil");
    await supabase.auth.signOut();
    return { error: MESSAGES.unexpected };
  }

  const role = profile.role as Role;
  const roleIsKnown = role === ROLES.ADMIN || role === ROLES.SELLER;

  if (!profile.is_active || !roleIsKnown) {
    await supabase.auth.signOut();
    return { error: MESSAGES.inactive };
  }

  const rawRedirect = formData.get("redirectTo");
  const target = safeRedirect(
    role,
    typeof rawRedirect === "string" ? rawRedirect : null,
  );

  redirect(target);
}
