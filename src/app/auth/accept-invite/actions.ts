"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resetPasswordSchema } from "@/validations";
import { ROLES, ROUTES, type Role } from "@/lib/constants";

export interface AcceptInviteState {
  error: string | null;
  fieldErrors?: { password?: string; confirmPassword?: string };
}

const MESSAGES = {
  noSession:
    "Este enlace ya no es válido. Pide a un administrador que reenvíe tu invitación.",
  unexpected: "No pudimos completar tu registro. Intenta de nuevo.",
} as const;

/**
 * Fija la contraseña del vendedor invitado y activa su cuenta.
 *
 * Requiere la sesión TEMPORAL que deja el enlace de invitación (intercambiada
 * en `/auth/callback`) — nunca se le pide la contraseña ACTUAL porque no
 * tiene una todavía. Tras fijarla: `accept_seller_invitation()` (RPC) pasa
 * la cuenta a ACTIVE y la invitación a ACCEPTED, ambas server-side.
 */
export async function acceptInviteAction(
  _prev: AcceptInviteState,
  formData: FormData,
): Promise<AcceptInviteState> {
  const parsed = resetPasswordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return {
      error: null,
      fieldErrors: {
        password: fieldErrors.password?.[0],
        confirmPassword: fieldErrors.confirmPassword?.[0],
      },
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: MESSAGES.noSession };
  }

  const { error: updateErr } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (updateErr) {
    return { error: MESSAGES.unexpected };
  }

  const { data: acceptRes, error: acceptErr } = await supabase.rpc("accept_seller_invitation");
  if (acceptErr || !acceptRes || (acceptRes as { ok?: boolean }).ok !== true) {
    return { error: MESSAGES.unexpected };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  const role: Role = profile?.role === ROLES.ADMIN ? ROLES.ADMIN : ROLES.SELLER;

  redirect(role === ROLES.ADMIN ? ROUTES.admin : ROUTES.seller);
}
