"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireZone } from "@/lib/auth/session";
import { ROUTES } from "@/lib/constants";

/**
 * Edición del PROPIO perfil del administrador.
 *
 * Solo toca los campos de identidad. El rol, el estado de la cuenta y
 * `is_active` NO viajan en este payload — no se pueden cambiar desde aquí ni
 * por accidente ni a propósito, y la protección de columnas privilegiadas de
 * la base sigue siendo la autoridad.
 *
 * La fila que se actualiza es SIEMPRE la de `auth.uid()`: el id no se acepta
 * desde el navegador.
 */

export interface ProfileFormResult {
  ok: boolean;
  error?: string;
}

const clean = (value: FormDataEntryValue | null, max: number): string | null => {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : null;
};

export async function updateMyAdminProfile(
  _prev: ProfileFormResult,
  formData: FormData,
): Promise<ProfileFormResult> {
  const ctx = await requireZone("admin");
  const supabase = await createClient();

  const firstName = clean(formData.get("firstName"), 80);
  const lastName = clean(formData.get("lastName"), 80);
  const displayName = clean(formData.get("displayName"), 120);
  const phone = clean(formData.get("phone"), 40);

  if (!firstName && !displayName) {
    return { ok: false, error: "Escribe al menos tu nombre." };
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      first_name: firstName,
      last_name: lastName,
      display_name: displayName,
      phone,
      // `full_name` lo mantiene sincronizado la base: así el nombre nuevo
      // aparece al instante en actividad, historiales y notificaciones.
    })
    .eq("id", ctx.userId);

  if (error) {
    if (process.env.NODE_ENV !== "production") console.error("[perfil]", error);
    return { ok: false, error: "No pudimos guardar los cambios." };
  }

  revalidatePath(ROUTES.adminPerfil);
  revalidatePath(ROUTES.admin);
  return { ok: true };
}
