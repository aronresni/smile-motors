"use server";

import { createClient } from "@/lib/supabase/server";

/**
 * Alta y baja del dispositivo actual.
 *
 * Van con la sesión del usuario (nunca service_role): el dueño lo decide
 * `auth.uid()` dentro de la RPC, así que nadie puede registrar ni dar de baja
 * el dispositivo de otro aunque manipule la petición.
 */

export interface PushActionResult {
  ok: boolean;
  code?: string;
}

export interface RegisterPushInput {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
  deviceLabel?: string | null;
}

export async function registerPushSubscription(
  input: RegisterPushInput,
): Promise<PushActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("push_subscription_register", {
    p_endpoint: input.endpoint,
    p_p256dh: input.p256dh,
    p_auth: input.auth,
    p_user_agent: input.userAgent ?? undefined,
    p_device_label: input.deviceLabel ?? undefined,
  });
  if (error) {
    if (process.env.NODE_ENV !== "production") console.error("[push:register]", error);
    return { ok: false, code: "UNEXPECTED" };
  }
  const result = data as { ok?: boolean; code?: string } | null;
  return { ok: Boolean(result?.ok), code: result?.code };
}

export async function revokePushSubscription(endpoint: string): Promise<PushActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("push_subscription_revoke", {
    p_endpoint: endpoint,
  });
  if (error) {
    if (process.env.NODE_ENV !== "production") console.error("[push:revoke]", error);
    return { ok: false, code: "UNEXPECTED" };
  }
  const result = data as { ok?: boolean; code?: string } | null;
  return { ok: Boolean(result?.ok), code: result?.code };
}
