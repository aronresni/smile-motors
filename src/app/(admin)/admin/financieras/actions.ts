"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireZone } from "@/lib/auth/session";
import { ROUTES } from "@/lib/constants";
import type { FeeStrategy } from "@/lib/payments/fee-engine";
import type { PaymentMethodType } from "@/lib/admin/financing";

/**
 * Acciones de administración de financieras. TODAS pasan por RPC
 * `SECURITY DEFINER` que vuelven a exigir `is_admin()` server-side — el
 * mismo patrón que vendedores/ventas. `requireZone("admin")` es la primera
 * barrera (redirige si no hay sesión admin), la RPC es la segunda y
 * definitiva (nunca confiar solo en la UI).
 *
 * Tras cualquier mutación se revalida tanto el/los listado(s) de Admin como
 * las rutas de Vendedor que leen el catálogo (`getPaymentCatalog()`) para
 * que las nuevas ventas nunca vean opciones obsoletas.
 */
export interface RpcResult {
  ok: boolean;
  code?: string;
  [key: string]: unknown;
}

function revalidateFinancing(providerId?: string) {
  revalidatePath(ROUTES.adminFinancieras);
  if (providerId) revalidatePath(`${ROUTES.adminFinancieras}/${providerId}`);
  // El selector de financiación del vendedor es 100% database-driven
  // (`getPaymentCatalog()`) — revalidar para que nunca quede una opción
  // obsoleta en una venta nueva.
  revalidatePath(ROUTES.sellerVentaNuevaCuba);
  revalidatePath(ROUTES.sellerVentas);
}

export interface CreateProviderInput {
  legacyId: string;
  name: string;
  methodType: PaymentMethodType;
  subtext?: string;
  instructions?: string;
  isActive: boolean;
  position?: number;
  requiresSignedContract: boolean;
  onlyFlorida: boolean;
  websiteUrl?: string;
  websiteEnabled: boolean;
  feeStrategy: FeeStrategy;
  flatFeeBps?: number;
  flatFeeCents?: number;
  conditionalThresholdCents?: number;
  conditionalBelowFeeCents?: number;
  conditionalAboveFeeBps?: number;
}

export async function createProvider(input: CreateProviderInput): Promise<RpcResult> {
  await requireZone("admin");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_create_payment_provider", {
    p_legacy_id: input.legacyId,
    p_name: input.name,
    p_method_type: input.methodType,
    p_subtext: input.subtext || undefined,
    p_instructions: input.instructions || undefined,
    p_is_active: input.isActive,
    p_position: input.position ?? 0,
    p_requires_signed_contract: input.methodType === "FINANCING" ? input.requiresSignedContract : false,
    p_only_florida: input.methodType === "FINANCING" ? input.onlyFlorida : false,
    p_website_url: input.websiteUrl || undefined,
    p_website_enabled: input.websiteEnabled,
    p_fee_strategy: input.feeStrategy,
    p_flat_fee_bps: input.flatFeeBps,
    p_flat_fee_cents: input.flatFeeCents,
    p_conditional_threshold_cents: input.conditionalThresholdCents,
    p_conditional_below_fee_cents: input.conditionalBelowFeeCents,
    p_conditional_above_fee_bps: input.conditionalAboveFeeBps,
  });
  if (error || !data) return { ok: false, code: "UNEXPECTED" };
  revalidateFinancing();
  return data as RpcResult;
}

export interface UpdateProviderInput {
  providerId: string;
  name: string;
  methodType: PaymentMethodType;
  subtext?: string;
  instructions?: string;
  position?: number;
  requiresSignedContract: boolean;
  onlyFlorida: boolean;
  websiteUrl?: string;
  websiteEnabled: boolean;
  feeStrategy: FeeStrategy;
  flatFeeBps?: number;
  flatFeeCents?: number;
  conditionalThresholdCents?: number;
  conditionalBelowFeeCents?: number;
  conditionalAboveFeeBps?: number;
}

export async function updateProvider(input: UpdateProviderInput): Promise<RpcResult> {
  await requireZone("admin");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_update_payment_provider", {
    p_provider_id: input.providerId,
    p_name: input.name,
    p_subtext: input.subtext || undefined,
    p_instructions: input.instructions || undefined,
    p_position: input.position ?? 0,
    p_requires_signed_contract: input.methodType === "FINANCING" ? input.requiresSignedContract : false,
    p_only_florida: input.methodType === "FINANCING" ? input.onlyFlorida : false,
    p_website_url: input.websiteUrl || undefined,
    p_website_enabled: input.websiteEnabled,
    p_fee_strategy: input.feeStrategy,
    p_flat_fee_bps: input.flatFeeBps,
    p_flat_fee_cents: input.flatFeeCents,
    p_conditional_threshold_cents: input.conditionalThresholdCents,
    p_conditional_below_fee_cents: input.conditionalBelowFeeCents,
    p_conditional_above_fee_bps: input.conditionalAboveFeeBps,
  });
  if (error || !data) return { ok: false, code: "UNEXPECTED" };
  revalidateFinancing(input.providerId);
  return data as RpcResult;
}

export async function setProviderActive(providerId: string, active: boolean): Promise<RpcResult> {
  await requireZone("admin");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_set_payment_provider_active", {
    p_provider_id: providerId,
    p_active: active,
  });
  if (error || !data) return { ok: false, code: "UNEXPECTED" };
  revalidateFinancing(providerId);
  return data as RpcResult;
}

export interface CreatePlanInput {
  providerId: string;
  label: string;
  termMonths?: number;
  feeBps: number;
}

export async function createPlan(input: CreatePlanInput): Promise<RpcResult> {
  await requireZone("admin");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_create_payment_plan", {
    p_provider_id: input.providerId,
    p_label: input.label,
    p_term_months: input.termMonths,
    p_fee_bps: input.feeBps,
  });
  if (error || !data) return { ok: false, code: "UNEXPECTED" };
  revalidateFinancing(input.providerId);
  return data as RpcResult;
}

export interface UpdatePlanInput {
  planId: string;
  providerId: string;
  label: string;
  termMonths?: number;
  feeBps: number;
}

export async function updatePlan(input: UpdatePlanInput): Promise<RpcResult> {
  await requireZone("admin");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_update_payment_plan", {
    p_plan_id: input.planId,
    p_label: input.label,
    p_term_months: input.termMonths,
    p_fee_bps: input.feeBps,
  });
  if (error || !data) return { ok: false, code: "UNEXPECTED" };
  revalidateFinancing(input.providerId);
  return data as RpcResult;
}

export async function setPlanActive(planId: string, providerId: string, active: boolean): Promise<RpcResult> {
  await requireZone("admin");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_set_payment_plan_active", {
    p_plan_id: planId,
    p_active: active,
  });
  if (error || !data) return { ok: false, code: "UNEXPECTED" };
  revalidateFinancing(providerId);
  return data as RpcResult;
}

export async function reorderPlans(providerId: string, orderedPlanIds: string[]): Promise<RpcResult> {
  await requireZone("admin");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_reorder_payment_plans", {
    p_provider_id: providerId,
    p_ordered_plan_ids: orderedPlanIds,
  });
  if (error || !data) return { ok: false, code: "UNEXPECTED" };
  revalidateFinancing(providerId);
  return data as RpcResult;
}
