import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { FeeStrategy } from "@/lib/payments/fee-engine";

/**
 * Financieras / métodos de pago — capa de datos de Admin. Todo pasa por las
 * RPC `admin_payment_provider_*`/`admin_create_payment_provider`/etc.
 * (`SECURITY DEFINER`, verifican `is_admin()` server-side) — nunca se lee o
 * escribe `payment_methods`/`payment_method_plans` directo desde aquí, salvo
 * el propio `select` que hacen esas RPC.
 */
export type PaymentMethodType = "CARD" | "ZELLE" | "FINANCING" | "INTERNAL";

export interface AdminProviderListItem {
  providerId: string;
  legacyId: string;
  name: string;
  methodType: PaymentMethodType;
  isActive: boolean;
  feeStrategy: FeeStrategy;
  flatFeeBps: number | null;
  flatFeeCents: number | null;
  requiresSignedContract: boolean;
  onlyFlorida: boolean;
  planCount: number;
  salesUsingCount: number;
}

export interface AdminProviderListFilters {
  search: string;
  /** "DIRECT" no es un `method_type` real — la RPC lo traduce a
   * CARD/ZELLE/INTERNAL server-side (ver `admin_payment_provider_list`). */
  type: "ALL" | "DIRECT" | PaymentMethodType;
  status: "ALL" | "ACTIVE" | "INACTIVE";
  contract: "ALL" | "REQUIRED" | "NOT_REQUIRED";
}

export async function getAdminProviderList(filters: AdminProviderListFilters): Promise<AdminProviderListItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_payment_provider_list", {
    p_search: filters.search || undefined,
    p_type: filters.type,
    p_status: filters.status,
    p_contract: filters.contract,
  });
  if (error || !data) return [];
  const res = data as unknown as { ok: boolean; items?: AdminProviderListItem[] };
  if (!res.ok) return [];
  return res.items ?? [];
}

export interface AdminProviderFull {
  id: string;
  legacy_id: string;
  method_type: PaymentMethodType;
  name: string;
  subtext: string | null;
  instructions: string | null;
  icon_key: string | null;
  is_active: boolean;
  website_url: string | null;
  website_enabled: boolean;
  only_florida: boolean;
  requires_signed_contract: boolean;
  fee_strategy: FeeStrategy;
  flat_fee_bps: number | null;
  flat_fee_cents: number | null;
  conditional_threshold_cents: number | null;
  conditional_below_fee_cents: number | null;
  conditional_above_fee_bps: number | null;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface AdminProviderPlan {
  id: string;
  label: string;
  termMonths: number | null;
  feeBps: number;
  isActive: boolean;
  position: number;
  salesUsingCount: number;
}

export interface AdminProviderUsage {
  salesCount: number;
  grossAllocatedCents: number;
  netAccreditedCents: number;
  contractsSent: number;
  contractsSigned: number;
  contractsAccredited: number;
}

export interface AdminProviderEvent {
  eventType: string;
  actorName: string | null;
  planLabel: string | null;
  changes: Record<string, unknown> | null;
  createdAt: string;
}

export interface AdminProviderDetail {
  provider: AdminProviderFull;
  plans: AdminProviderPlan[];
  usage: AdminProviderUsage;
  recentEvents: AdminProviderEvent[];
}

export async function getAdminProviderDetail(providerId: string): Promise<AdminProviderDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_payment_provider_detail", { p_provider_id: providerId });
  if (error || !data) return null;
  const res = data as unknown as { ok: boolean } & Partial<AdminProviderDetail>;
  if (!res.ok || !res.provider) return null;
  return {
    provider: res.provider,
    plans: res.plans ?? [],
    usage: res.usage ?? {
      salesCount: 0,
      grossAllocatedCents: 0,
      netAccreditedCents: 0,
      contractsSent: 0,
      contractsSigned: 0,
      contractsAccredited: 0,
    },
    recentEvents: res.recentEvents ?? [],
  };
}
