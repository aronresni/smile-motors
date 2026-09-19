"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createInviteLink } from "@/lib/auth/invite-link";
import { requireZone } from "@/lib/auth/session";
import { ROUTES } from "@/lib/constants";

/**
 * Acciones de administración de vendedores. Dos niveles de confianza:
 *
 *  - Las transiciones de estado (registrar invitación, reenviar, cancelar,
 *    suspender, reactivar, deshabilitar) son RPC `SECURITY DEFINER` que
 *    vuelven a exigir `is_admin()` server-side — el mismo patrón que el
 *    resto de la app (nunca un botón deshabilitado es la única barrera).
 *  - SOLO generar el enlace de invitación necesita la API de administración
 *    de Supabase Auth, que exige la clave `service_role` — por eso, y solo
 *    para esas dos acciones, se usa `createAdminClient()` (servidor
 *    únicamente, ver `lib/supabase/admin.ts` y `lib/auth/invite-link.ts`).
 *    ANTES de tocar ese cliente, se exige la zona admin con el cliente
 *    normal (RLS) — la clave de servicio nunca decide sola quién es admin.
 *
 * El enlace se DEVUELVE al administrador para que se lo pase al vendedor; no
 * se envía por el correo de Supabase (servicio de pruebas, limitado a unos
 * pocos envíos por hora) ni se guarda en la base.
 */

export interface RpcResult {
  ok: boolean;
  code?: string;
  [key: string]: unknown;
}

function revalidateSellers(sellerId?: string) {
  revalidatePath(ROUTES.adminVendedores);
  if (sellerId) revalidatePath(`${ROUTES.adminVendedores}/${sellerId}`);
}

export interface InviteSellerInput {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
}

/** INVITAR VENDEDOR — crea la cuenta en estado INVITADO, registra la
 * trazabilidad y devuelve el ENLACE para que el administrador se lo pase al
 * vendedor. Rol SIEMPRE 'seller': este formulario simple no permite invitar
 * administradores. */
export async function inviteSeller(input: InviteSellerInput): Promise<RpcResult> {
  const ctx = await requireZone("admin");

  const email = input.email.trim().toLowerCase();
  const fullName = `${input.firstName.trim()} ${input.lastName.trim()}`.trim();
  if (!email || !fullName) {
    return { ok: false, code: "INVALID_INPUT" };
  }

  const invite = await createInviteLink(email, {
    full_name: fullName,
    role: "seller",
    account_status: "INVITED",
    phone: input.phone?.trim() || undefined,
  });
  if (!invite.ok) return { ok: false, code: invite.code };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_record_seller_invitation", {
    p_seller_id: invite.link.userId,
    p_email: email,
  });
  if (error || !data) return { ok: false, code: "RECORD_FAILED" };

  revalidateSellers();
  void ctx; // ya validado arriba; se mantiene por claridad del flujo
  return { ...(data as RpcResult), inviteUrl: invite.link.url };
}

/** REENVIAR INVITACIÓN — reutiliza el MISMO usuario/perfil, nunca crea uno nuevo. */
export async function resendSellerInvitation(sellerId: string): Promise<RpcResult> {
  await requireZone("admin");

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("email, account_status")
    .eq("id", sellerId)
    .single();
  if (!profile?.email) return { ok: false, code: "SELLER_NOT_FOUND" };
  if (profile.account_status !== "INVITED") return { ok: false, code: "INVALID_STATUS" };

  // Genera un enlace NUEVO (el anterior deja de servir) para el MISMO usuario.
  const invite = await createInviteLink(profile.email);
  if (!invite.ok) return { ok: false, code: invite.code };

  const { data, error } = await supabase.rpc("admin_touch_seller_invitation", { p_seller_id: sellerId });
  if (error || !data) return { ok: false, code: "RECORD_FAILED" };

  revalidateSellers(sellerId);
  return { ...(data as RpcResult), inviteUrl: invite.link.url };
}

export async function cancelSellerInvitation(sellerId: string): Promise<RpcResult> {
  await requireZone("admin");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_cancel_seller_invitation", { p_seller_id: sellerId });
  if (error || !data) return { ok: false, code: "UNEXPECTED" };
  revalidateSellers(sellerId);
  return data as RpcResult;
}

export async function suspendSeller(sellerId: string, reason?: string): Promise<RpcResult> {
  await requireZone("admin");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_suspend_seller", {
    p_seller_id: sellerId,
    p_reason: reason?.trim() || undefined,
  });
  if (error || !data) return { ok: false, code: "UNEXPECTED" };
  revalidateSellers(sellerId);
  return data as RpcResult;
}

export async function reactivateSeller(sellerId: string): Promise<RpcResult> {
  await requireZone("admin");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_reactivate_seller", { p_seller_id: sellerId });
  if (error || !data) return { ok: false, code: "UNEXPECTED" };
  revalidateSellers(sellerId);
  return data as RpcResult;
}

export async function disableSeller(sellerId: string, reason?: string): Promise<RpcResult> {
  await requireZone("admin");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_disable_seller", {
    p_seller_id: sellerId,
    p_reason: reason?.trim() || undefined,
  });
  if (error || !data) return { ok: false, code: "UNEXPECTED" };
  revalidateSellers(sellerId);
  return data as RpcResult;
}
