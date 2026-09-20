"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createInviteLink, digestOfInviteUrl, siteUrl } from "@/lib/auth/invite-link";
import { getInvitationMailer } from "@/lib/email/resend-mailer";
import {
  deliverInvitationEmail,
  type EmailDeliveryResult,
} from "@/lib/invitations/deliver-invitation-email";
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
 * El enlace se DEVUELVE al administrador (Copiar / WhatsApp) y, ADEMÁS, se
 * intenta enviar por correo con Resend — siempre el MISMO enlace, sin un
 * segundo token (ver `lib/invitations/deliver-invitation-email.ts`). Si el
 * correo falla, la invitación queda intacta: nunca se deshace por eso. El
 * enlace no se guarda en la base (solo su resumen SHA-256) ni se envía por el
 * correo de Supabase (servicio de pruebas, limitado a unos pocos por hora).
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

/** Resultado del correo que ve el admin (la invitación ya existe). */
export interface InvitationEmailOutcome {
  emailStatus: EmailDeliveryResult["status"];
  emailCode?: string;
}

async function sendInvitationEmail(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sellerId: string,
  inviteUrl: string,
  linkDigest: string,
): Promise<InvitationEmailOutcome> {
  const result = await deliverInvitationEmail(supabase, getInvitationMailer(), {
    sellerId,
    inviteUrl,
    linkDigest,
    siteUrl: siteUrl(),
  });
  return { emailStatus: result.status, emailCode: result.code };
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
    p_link_digest: invite.link.digest,
  });
  if (error || !data) return { ok: false, code: "RECORD_FAILED" };
  const recorded = data as RpcResult;
  if (!recorded.ok) return recorded;

  // Canal adicional: su resultado nunca deshace la invitación ya registrada.
  const delivery = await sendInvitationEmail(supabase, invite.link.userId, invite.link.url, invite.link.digest);

  revalidateSellers();
  void ctx; // ya validado arriba; se mantiene por claridad del flujo
  return { ...recorded, sellerId: invite.link.userId, inviteUrl: invite.link.url, ...delivery };
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

  const { data, error } = await supabase.rpc("admin_touch_seller_invitation", {
    p_seller_id: sellerId,
    p_link_digest: invite.link.digest,
  });
  if (error || !data) return { ok: false, code: "RECORD_FAILED" };
  const touched = data as RpcResult;
  if (!touched.ok) return touched;

  // El correo lleva el enlace NUEVO; el anterior ya quedó invalidado.
  const delivery = await sendInvitationEmail(supabase, sellerId, invite.link.url, invite.link.digest);

  revalidateSellers(sellerId);
  return { ...touched, sellerId, inviteUrl: invite.link.url, ...delivery };
}

/**
 * REINTENTAR / REENVIAR CORREO — vuelve a enviar por correo el enlace que el
 * admin tiene en pantalla, SIN generar otro token. El servidor comprueba que
 * ese enlace sea de esta app y el VIGENTE de ese vendedor (resumen SHA-256):
 * nunca se envía un enlace ya invalidado ni una URL arbitraria. El
 * destinatario sale de la base, no del navegador. Si el enlace dejó de ser
 * el vigente, el admin debe usar "Reenviar invitación" (genera uno nuevo).
 */
export async function retrySellerInvitationEmail(
  sellerId: string,
  inviteUrl: string,
): Promise<RpcResult> {
  await requireZone("admin");

  const digest = digestOfInviteUrl(inviteUrl);
  if (!digest) return { ok: false, code: "STALE_LINK" };

  const supabase = await createClient();
  const delivery = await sendInvitationEmail(supabase, sellerId, inviteUrl, digest);
  revalidateSellers(sellerId);
  return { ok: true, sellerId, inviteUrl, ...delivery };
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
