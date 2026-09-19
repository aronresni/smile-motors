/**
 * Importa el catálogo de métodos de pago / financieras a las tablas
 * `payment_methods` y `payment_method_plans`.
 *
 * IDEMPOTENTE: reconcilia por `legacy_id`. Correrlo dos veces NO duplica nada.
 * Importa TODOS los métodos (activos e inactivos). Normaliza porcentajes a
 * basis points y montos a centavos enteros. NO inventa configuración de fee.
 *
 * Uso:
 *   node --env-file=.env.local supabase/scripts/import-payment-methods.mjs [ruta.json]
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

const SRC =
  process.argv[2] ??
  path.resolve("supabase/seed-data/payment-methods-legacy-import-ready.json");
const raw = JSON.parse(fs.readFileSync(SRC, "utf8"));
const rows = Array.isArray(raw) ? raw : (raw.data ?? []);

/* --------------------------- helpers ---------------------------- */
const nn = (s) => {
  const t = (s ?? "").toString().trim();
  return t === "" ? null : t;
};
/** porcentaje "humano" (10, 3.5, 150) -> basis points enteros. */
const pctToBps = (v) =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) : null;
/** fracción (0.1895, 0.06) -> basis points enteros. */
const fracToBps = (v) =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10000) : null;
/** dólares -> centavos enteros. */
const dollarsToCents = (v) =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) : null;

const FEE_STRATEGY_MAP = {
  none: "NONE",
  flat_rate: "FLAT_RATE",
  fixed_amount: "FIXED_AMOUNT",
  fixed_plus_percent: "FIXED_PLUS_PERCENT",
  installments: "INSTALLMENTS",
  conditional: "CONDITIONAL",
};

function methodType(legacyId) {
  if (legacyId === "cc") return "CARD";
  if (legacyId === "zelle") return "ZELLE";
  if (legacyId === "internal" || legacyId === "custom-tsl8m") return "INTERNAL"; // CASH
  return "FINANCING";
}

/** meses del label del plan: "6 Meses" -> 6, "36 MESES " -> 36, "SIN INTERES" -> null. */
function termMonths(label) {
  const m = /(\d{1,3})\s*mes/i.exec(label ?? "");
  return m ? Number.parseInt(m[1], 10) : null;
}

/* ---------------------- normalización ---------------------- */
const report = {
  total: rows.length,
  active: 0,
  inactive: 0,
  financing: 0,
  direct: 0, // CARD + ZELLE
  internal: 0,
  withPlans: 0,
  plansTotal: 0,
  floridaOnly: 0,
  requiresContract: 0,
  withQueue: 0,
  malformed: [],
};

const methods = [];
const plansByLegacy = new Map();

rows.forEach((r, i) => {
  const legacyId = nn(r.id);
  if (!legacyId) {
    report.malformed.push(`fila ${i}: sin id`);
    return;
  }
  const feeStrategy = FEE_STRATEGY_MAP[r.feeStrategy] ?? "NONE";
  if (r.feeStrategy && !FEE_STRATEGY_MAP[r.feeStrategy]) {
    report.malformed.push(`${legacyId}: feeStrategy desconocida "${r.feeStrategy}" -> NONE`);
  }
  const mtype = methodType(legacyId);

  const flatFeeBps = pctToBps(r.flatFeePercent);
  const flatFeeCents = dollarsToCents(r.flatFeeDollar);
  const condThreshold = dollarsToCents(r.conditionalThreshold);
  const condBelow = dollarsToCents(r.conditionalBelowDollar);
  const condAboveBps = pctToBps(r.conditionalAbovePercent);

  // Validación de completitud de la config de fee (no se inventa nada).
  if (feeStrategy === "FLAT_RATE" && flatFeeBps == null)
    report.malformed.push(`${legacyId}: FLAT_RATE sin flatFeePercent`);
  if (feeStrategy === "FIXED_AMOUNT" && flatFeeCents == null)
    report.malformed.push(`${legacyId}: FIXED_AMOUNT sin flatFeeDollar`);
  if (feeStrategy === "FIXED_PLUS_PERCENT" && (flatFeeCents == null || flatFeeBps == null))
    report.malformed.push(`${legacyId}: FIXED_PLUS_PERCENT sin fijo o porcentaje`);
  if (feeStrategy === "CONDITIONAL" && (condThreshold == null || condBelow == null || condAboveBps == null))
    report.malformed.push(`${legacyId}: CONDITIONAL con configuración incompleta`);
  if (feeStrategy === "INSTALLMENTS" && !Array.isArray(r.variableFees))
    report.malformed.push(`${legacyId}: INSTALLMENTS sin variableFees (0 planes)`);
  if (feeStrategy !== "FLAT_RATE" && feeStrategy !== "FIXED_PLUS_PERCENT" && r.flatFeePercent != null)
    report.malformed.push(`${legacyId}: flatFeePercent=${r.flatFeePercent} ignorado por estrategia ${feeStrategy}`);

  const method = {
    legacy_id: legacyId,
    method_type: mtype,
    name: nn(r.name) ?? legacyId,
    subtext: nn(r.subtext),
    icon_key: nn(r.icon),
    is_active: Boolean(r.isActive), // NUNCA el flag legacy `enabled`
    website_url: nn(r.websiteUrl),
    website_enabled: Boolean(r.websiteEnabled),
    only_florida: Boolean(r.onlyFlorida),
    requires_signed_contract: Boolean(r.requiresSignedContract),
    has_queue: Boolean(r.hasQueue),
    queue_limit_mode: nn(r.queueLimitMode),
    queue_daily_limit:
      typeof r.queueDailyLimit === "number" ? Math.round(r.queueDailyLimit) : null,
    branch_scope: nn(r.branchScope),
    fee_strategy: feeStrategy,
    flat_fee_bps: flatFeeBps,
    flat_fee_cents: flatFeeCents,
    conditional_threshold_cents: condThreshold,
    conditional_below_fee_cents: condBelow,
    conditional_above_fee_bps: condAboveBps,
    interest_paid_by_customer_fee_bps: pctToBps(r.interestPaidByCustomerFeePercent),
    zelle_account: nn(r.zelleAccount),
    position: i,
  };
  methods.push(method);

  if (method.is_active) report.active++;
  else report.inactive++;
  if (mtype === "FINANCING") report.financing++;
  if (mtype === "CARD" || mtype === "ZELLE") report.direct++;
  if (mtype === "INTERNAL") report.internal++;
  if (method.only_florida) report.floridaOnly++;
  if (method.requires_signed_contract) report.requiresContract++;
  if (method.has_queue) report.withQueue++;

  const plans = Array.isArray(r.variableFees)
    ? r.variableFees.map((p, idx) => ({
        legacy_code: nn(p.code),
        label: nn(p.label) ?? `Plan ${idx + 1}`,
        fee_bps: fracToBps(p.fee) ?? 0,
        term_months: termMonths(p.label),
        position: idx,
        is_active: true,
      }))
    : [];
  if (plans.length > 0) {
    report.withPlans++;
    report.plansTotal += plans.length;
    plansByLegacy.set(legacyId, plans);
  }
});

/* --------------------------- upsert --------------------------- */
console.log(`Importando ${methods.length} métodos...`);

const { data: upserted, error: upErr } = await admin
  .from("payment_methods")
  .upsert(methods, { onConflict: "legacy_id" })
  .select("id, legacy_id");
if (upErr) throw upErr;

const idByLegacy = new Map(upserted.map((m) => [m.legacy_id, m.id]));

// Planes: reemplazo completo por método (idempotente).
let plansWritten = 0;
for (const [legacyId, plans] of plansByLegacy) {
  const methodId = idByLegacy.get(legacyId);
  if (!methodId) continue;
  await admin.from("payment_method_plans").delete().eq("payment_method_id", methodId);
  const rowsToInsert = plans.map((p) => ({ ...p, payment_method_id: methodId }));
  const { error } = await admin.from("payment_method_plans").insert(rowsToInsert);
  if (error) throw error;
  plansWritten += rowsToInsert.length;
}
// Métodos que dejaron de tener planes: limpiar los previos.
for (const m of methods) {
  if (plansByLegacy.has(m.legacy_id)) continue;
  const methodId = idByLegacy.get(m.legacy_id);
  if (methodId) {
    await admin.from("payment_method_plans").delete().eq("payment_method_id", methodId);
  }
}

/* --------------------------- reporte -------------------------- */
console.log("\n=== REPORTE DE IMPORTACIÓN ===");
console.log(JSON.stringify(
  {
    totalPaymentMethods: report.total,
    active: report.active,
    inactive: report.inactive,
    financingMethods: report.financing,
    directPaymentMethods: report.direct,
    internalMethods: report.internal,
    providersWithInstallmentPlans: report.withPlans,
    plansImported: plansWritten,
    floridaOnly: report.floridaOnly,
    requiresSignedContract: report.requiresContract,
    withQueue: report.withQueue,
    malformedOrIncomplete: report.malformed,
  },
  null,
  2,
));
