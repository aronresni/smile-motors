import "server-only";
import { createClient } from "@/lib/supabase/server";
import type {
  PaymentMethodType,
  PaymentMethodView,
  PaymentPlanView,
} from "@/lib/payments/allocation";
import type { FeeStrategy } from "@/lib/payments/fee-engine";

/**
 * Catálogo de métodos de pago disponibles para el vendedor.
 *
 * - Solo métodos `is_active = true` (la RLS ya lo restringe; se filtra igual).
 * - Ámbito de sucursal: esta app es Vita Motors → se muestran `branch_scope`
 *   nulo, `vita` o `all`; se ocultan los de otra sucursal.
 * - El vendedor NO puede crear/editar métodos ni fees (admin, en otra tarea).
 */

export interface PaymentCatalog {
  methods: PaymentMethodView[];
  byId: Record<string, PaymentMethodView>;
}

const VISIBLE_BRANCH_SCOPES = new Set<string | null>([null, "", "vita", "all"]);

export async function getPaymentCatalog(): Promise<PaymentCatalog> {
  const supabase = await createClient();

  const [{ data: methods, error: mErr }, { data: plans, error: pErr }] =
    await Promise.all([
      supabase
        .from("payment_methods")
        .select("*")
        .eq("is_active", true)
        .order("position", { ascending: true }),
      supabase
        .from("payment_method_plans")
        .select("*")
        .eq("is_active", true)
        .order("position", { ascending: true }),
    ]);

  if (mErr || pErr || !methods) {
    return { methods: [], byId: {} };
  }

  const plansByMethod = new Map<string, PaymentPlanView[]>();
  for (const p of plans ?? []) {
    const list = plansByMethod.get(p.payment_method_id) ?? [];
    list.push({
      id: p.id,
      label: p.label,
      feeBps: p.fee_bps,
      termMonths: p.term_months,
      position: p.position,
    });
    plansByMethod.set(p.payment_method_id, list);
  }

  const views: PaymentMethodView[] = methods
    .filter((m) => VISIBLE_BRANCH_SCOPES.has(m.branch_scope))
    .map((m) => ({
      id: m.id,
      legacyId: m.legacy_id,
      methodType: m.method_type as PaymentMethodType,
      name: m.name.trim(),
      subtext: m.subtext,
      iconKey: m.icon_key,
      websiteUrl: m.website_url,
      websiteEnabled: m.website_enabled,
      onlyFlorida: m.only_florida,
      requiresSignedContract: m.requires_signed_contract,
      hasQueue: m.has_queue,
      branchScope: m.branch_scope,
      feeStrategy: m.fee_strategy as FeeStrategy,
      flatFeeBps: m.flat_fee_bps,
      flatFeeCents: m.flat_fee_cents,
      conditionalThresholdCents: m.conditional_threshold_cents,
      conditionalBelowFeeCents: m.conditional_below_fee_cents,
      conditionalAboveFeeBps: m.conditional_above_fee_bps,
      zelleAccount: m.zelle_account,
      position: m.position,
      plans: (plansByMethod.get(m.id) ?? []).sort(
        (a, b) => a.position - b.position,
      ),
    }));

  return {
    methods: views,
    byId: Object.fromEntries(views.map((v) => [v.id, v])),
  };
}
