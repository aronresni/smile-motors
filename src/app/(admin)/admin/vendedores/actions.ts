"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireZone } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { ROUTES } from "@/lib/constants";

/**
 * Acciones de administración de vendedores. Dos niveles de confianza:
 *
 *  - Las transiciones de estado (registrar invitación, reenviar, cancelar,
 *    suspender, reactivar, deshabilitar) son RPC `SECURITY DEFINER` que
 *    vuelven a exigir `is_admin()` server-side — el mismo patrón que el
 *    resto de la app (nunca un botón deshabilitado es la única barrera).
 *  - SOLO el envío/reenvío real del correo de invitación necesita la API de
 *    administración de Supabase Auth (`inviteUserByEmail`), que exige la
 *    clave `service_role` — por eso, y solo para esas dos acciones, se usa
 *    `createAdminClient()` (servidor únicamente, ver `lib/supabase/admin.ts`).
 *    ANTES de tocar ese cliente, se exige la zona admin con el cliente
 *    normal (RLS) — la clave de servicio nunca decide sola quién es admin.
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

function inviteRedirectUrl(): string {
  const accept = encodeURIComponent(ROUTES.authAcceptInvite);
  return `${env.NEXT_PUBLIC_SITE_URL}${ROUTES.authCallback}?redirectTo=${accept}`;
}

export interface InviteSellerInput {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
}

/** INVITAR VENDEDOR — envía la invitación por correo (Supabase Auth) y
 * registra la trazabilidad. Rol SIEMPRE 'seller': este formulario simple no
 * permite invitar administradores. */
export async function inviteSeller(input: InviteSellerInput): Promise<RpcResult> {
  const ctx = await requireZone("admin");

  const email = input.email.trim().toLowerCase();
  const fullName = `${input.firstName.trim()} ${input.lastName.trim()}`.trim();
  if (!email || !fullName) {
    return { ok: false, code: "INVALID_INPUT" };
  }

  const adminAuth = createAdminClient();
  const { data: inv, error: inviteErr } = await adminAuth.auth.admin.inviteUserByEmail(email, {
    data: {
      full_name: fullName,
      role: "seller",
      account_status: "INVITED",
      phone: input.phone?.trim() || undefined,
    },
    redirectTo: inviteRedirectUrl(),
  });

  if (inviteErr || !inv?.user) {
    // No se expone el error crudo de Supabase (puede incluir detalles internos).
    const code =
      inviteErr?.status === 429
        ? "RATE_LIMITED"
        : inviteErr?.message?.toLowerCase().includes("already")
          ? "EMAIL_ALREADY_INVITED"
          : "INVITE_FAILED";
    return { ok: false, code };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_record_seller_invitation", {
    p_seller_id: inv.user.id,
    p_email: email,
  });
  if (error || !data) return { ok: false, code: "RECORD_FAILED" };

  revalidateSellers();
  void ctx; // ya validado arriba; se mantiene por claridad del flujo
  return data as RpcResult;
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

  const adminAuth = createAdminClient();
  const { error: inviteErr } = await adminAuth.auth.admin.inviteUserByEmail(profile.email, {
    data: { account_status: "INVITED" },
    redirectTo: inviteRedirectUrl(),
  });
  if (inviteErr) {
    const code = inviteErr.status === 429 ? "RATE_LIMITED" : "INVITE_FAILED";
    return { ok: false, code };
  }

  const { data, error } = await supabase.rpc("admin_touch_seller_invitation", { p_seller_id: sellerId });
  if (error || !data) return { ok: false, code: "RECORD_FAILED" };

  revalidateSellers(sellerId);
  return data as RpcResult;
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
