/**
 * Integración REAL (contra la base) del PRECIO FIJO DE VENTA + COMISIÓN FIJA
 * (migración 20260919120000), con VALORES DE PRUEBA TEMPORALES de la fixture
 * `fixtures/commission-test-products.mjs`:
 *    1. $4,500 / $500 vendido en $4,500 → $500
 *    2. vendido en $4,700 → $600 (adicional $200: $100 vendedor / $100 tienda)
 *    3. vendido en $5,000 → $750 (+ redondeo al centavo a favor de la tienda)
 *    4. no se permite vender por debajo de $4,500 (envío, VENDIDA, ediciones)
 *    5. no se permite vender si falta el precio fijo
 *    6. no se permite vender si falta la comisión fija
 *    7. cambiar la configuración del producto no modifica comisiones históricas
 *    8. el vendedor no puede editar el precio fijo ni la comisión fija
 *    9. el administrador sí puede modificarlos (con validación clara)
 *   10. el desglose que muestran las fichas (RPC de resumen) es correcto
 *   11. los valores temporales se eliminan al terminar
 *   12. ningún seed/fixture de prueba modifica productos reales
 *   + los 8 niveles de prueba ($3,500–$5,999, comisión ≈ 10 %) venden bien.
 *
 * Uso:
 *   npm run test:commissions -- --admin e2e-smile-admin@motods.test \
 *     --seller e2e-smile-seller@motods.test
 *
 * Los valores SOLO se aplican a productos de prueba "E2E …" que este script
 * crea (vía las RPC reales de admin, las mismas que usa el panel) y elimina al
 * terminar. service_role solo lee verificaciones, limpia los datos propios y
 * —únicamente sobre sus productos de prueba— deja un valor sin configurar
 * (el panel ya no permite vaciarlos).
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import {
  COMMISSION_RATIO,
  COMMISSION_TEST_PRODUCTS,
  EXAMPLE_PRICING,
  FIXED_PRICE_RANGE_CENTS,
  commissionFixtureViolations,
  commissionTier,
  createCommissionTestProducts,
  createTestProduct,
  deleteTestProducts,
  expectedCommission,
  leftoverTestProducts,
  setTestProductPricing,
  snapshotRealProducts,
  unsetTestProductValue,
} from "./fixtures/commission-test-products.mjs";

const { values } = parseArgs({
  options: {
    admin: { type: "string" },
    seller: { type: "string" },
    password: { type: "string", default: process.env.E2E_PASSWORD },
  },
});
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON || !SERVICE || !values.admin || !values.seller || !values.password) {
  console.error("Faltan variables de entorno, --admin/--seller o E2E_PASSWORD (.env.local)");
  process.exit(1);
}
const svc = createClient(URL, SERVICE, { auth: { persistSession: false } });
async function signIn(email) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password: values.password });
  if (error) throw new Error(`login ${email}: ${error.message}`);
  return { c, id: data.user.id };
}
let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  ✔ ${name}`);
  } else {
    fail++;
    console.log(`  ✘ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
  }
}
async function rpc(client, fn, args) {
  const { data, error } = await client.rpc(fn, args);
  if (error) return { ok: false, code: `RPC_ERROR:${error.message}` };
  return data ?? { ok: true };
}
const usd = (cents) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const today = new Date().toISOString().slice(0, 10);
const ZELLE = "2ab4abc7-f6a4-41a9-84b0-e0d2d0668fce";
const created = { sales: [], products: [], requests: [] };
/** Foto de los datos REALES antes de crear nada (para comprobar al final). */
const baseline = { products: [], commissions: [], catalogEvents: 0 };

async function allCommissions() {
  const { data, error } = await svc.from("sale_commissions").select("*").order("id");
  if (error) throw new Error(`sale_commissions: ${error.message}`);
  return data ?? [];
}
async function catalogEventCount() {
  const { count } = await svc.from("product_catalog_events").select("id", { count: "exact", head: true });
  return count ?? 0;
}

async function main() {
  const admin = await signIn(values.admin);
  const seller = await signIn(values.seller);
  const stamp = Date.now().toString(36).toUpperCase();
  const PREFIX = `E2E COMISION ${stamp}`;

  baseline.products = await snapshotRealProducts(svc);
  baseline.commissions = await allCommissions();
  baseline.catalogEvents = await catalogEventCount();

  async function makeSale(productId, variantId, priceCents, { submit = true } = {}) {
    const { data: saleId, error } = await seller.c.rpc("create_sale_draft", { p_operation_type: "CUBA" });
    if (error) throw new Error(error.message);
    created.sales.push(saleId);
    const saved = await rpc(seller.c, "save_cuba_sale_draft", {
      p_sale_id: saleId,
      p_payload: {
        saleDate: today, shareCommission: false, internalNotes: "Venta de prueba de comisiones",
        buyer: {
          firstName: "E2E", lastName: "Comisiones", dateOfBirth: "1990-01-01", documentNumber: "E2E-CM-1",
          documentExpiration: "2031-01-01", phone: "(305) 555-0104", email: "", addressLine1: "1 Test St",
          addressLine2: "", city: "Miami", state: "FL", postalCode: "33101",
        },
        coBuyer: null,
        units: [{ productId, variantId, agreedPriceCents: priceCents }],
        extras: [],
        cubaRecipient: {
          fullName: "Destinatario E2E", identityNumber: "90010112345", deliveryAddress: "Calle 1 #2",
          municipality: "Plaza", province: "La Habana", phonePrimary: "+53 55555555", phoneSecondary: "",
        },
        delivery: { method: "HOME_DELIVERY", reference: "" },
        paymentAllocations: [{ id: null, paymentMethodId: ZELLE, planId: null, inputMode: "NET", amountCents: priceCents, reference: "E2E", notes: "" }],
      },
    });
    if (saved && saved.ok === false) throw new Error(`save: ${JSON.stringify(saved)}`);
    for (const [subject, side] of [["BUYER", "FRONT"], ["BUYER", "BACK"], ["CUBA_RECIPIENT", "FRONT"], ["CUBA_RECIPIENT", "BACK"]]) {
      const { error: de } = await seller.c.rpc("record_sale_document", {
        p_sale_id: saleId, p_subject_type: subject, p_side: side,
        p_storage_path: `${seller.id}/${saleId}/${subject.toLowerCase()}-${side.toLowerCase()}.jpg`,
        p_mime_type: "image/jpeg", p_file_size_bytes: 1000,
      });
      if (de) throw new Error(de.message);
    }
    if (submit) {
      const r = await rpc(seller.c, "request_sale_review", { p_sale_id: saleId });
      if (!r.ok) throw new Error(`review: ${JSON.stringify(r)}`);
    }
    return saleId;
  }
  const saleRow = async (id) => (await svc.from("sales").select("*").eq("id", id).single()).data;
  const unitOf = async (id) => (await svc.from("sale_units").select("*").eq("sale_id", id).order("position")).data?.[0];
  const commissionsOf = async (saleIds) =>
    (await svc.from("sale_commissions").select("*").in("sale_id", saleIds).order("sale_id")).data ?? [];
  const productRow = async (id) =>
    (await svc.from("products").select("is_active, default_reference_price_cents, default_base_commission_cents, updated_at").eq("id", id).single()).data;
  const missingAlertFor = async (productId) => {
    const r = await rpc(admin.c, "admin_alerts_list", { p_category: "COMISIONES", p_limit: 200 });
    return (r.items ?? []).find((a) => a.type === "CONFIG_COMISION_FALTANTE" && a.entityId === productId) ?? null;
  };
  /** VENDIDA con snapshot exacto (fijo, comisión fija, venta, adicional, parte del vendedor, final). */
  async function soldWith(label, saleId, by, pricing, salePriceCents) {
    const exp = expectedCommission(salePriceCents, pricing);
    const r = await rpc(by.c, "mark_sale_sold", { p_sale_id: saleId });
    const [c] = await commissionsOf([saleId]);
    check(
      `${label}: VENDIDA · venta ${usd(salePriceCents)} → comisión ${usd(exp.finalCommissionCents)} (adicional ${usd(exp.extraCents)}: ${usd(exp.sellerExtraCents)} vendedor / ${usd(exp.storeExtraCents)} tienda)`,
      r.ok === true && (await saleRow(saleId)).status === "SOLD" &&
        c?.reference_price_cents === pricing.fixedPriceCents && c?.base_commission_cents === pricing.fixedCommissionCents &&
        c?.sale_price_cents === salePriceCents && c?.price_difference_cents === exp.extraCents &&
        c?.seller_difference_share_cents === exp.sellerExtraCents && c?.final_commission_cents === exp.finalCommissionCents &&
        c?.source_type === "PRODUCT",
      { r, c },
    );
    return c;
  }
  async function expectBlocked(label, saleId, code) {
    const rs = await rpc(seller.c, "mark_sale_sold", { p_sale_id: saleId });
    const ra = await rpc(admin.c, "mark_sale_sold", { p_sale_id: saleId });
    const s = await saleRow(saleId);
    const u = await unitOf(saleId);
    const cs = await commissionsOf([saleId]);
    check(`${label}: VENDIDA bloqueada para vendedor y admin (${code})`, rs.ok === false && rs.code === code && ra.ok === false && ra.code === code, { vendedor: rs, admin: ra });
    check(`${label}: sigue PENDIENTE, sin número, sin seguimiento y sin comisión`, s.status === "PENDING" && s.sale_number == null && u.tracking_code == null && cs.length === 0, { status: s.status, t: u.tracking_code, cs: cs.length });
  }
  async function expectReviewBlocked(label, saleId, errorCode) {
    const r = await rpc(seller.c, "request_sale_review", { p_sale_id: saleId });
    check(`${label}: no se puede enviar a revisión (${errorCode})`, r.ok === false && r.code === "VALIDATION_FAILED" && (r.errors ?? []).includes(errorCode) && (await saleRow(saleId)).status === "DRAFT", r);
  }

  // ------------------------------------------------------------ fixture
  console.log("\nFIXTURE · Valores temporales de prueba");
  check("8 niveles + el ejemplo $4,500 / $500", COMMISSION_TEST_PRODUCTS.length === 8 && EXAMPLE_PRICING.fixedPriceCents === 450000 && EXAMPLE_PRICING.fixedCommissionCents === 50000);
  check("todos los precios fijos temporales entre $3,500 y $5,999", [...COMMISSION_TEST_PRODUCTS, EXAMPLE_PRICING].every((t) => t.fixedPriceCents >= FIXED_PRICE_RANGE_CENTS.min && t.fixedPriceCents <= FIXED_PRICE_RANGE_CENTS.max));
  check(
    `comisión fija ≈ 10 % (${[...COMMISSION_TEST_PRODUCTS, EXAMPLE_PRICING].map((t) => ((100 * t.fixedCommissionCents) / t.fixedPriceCents).toFixed(1) + " %").join(" · ")})`,
    [...COMMISSION_TEST_PRODUCTS, EXAMPLE_PRICING].every((t) => Math.abs(t.fixedCommissionCents / t.fixedPriceCents - COMMISSION_RATIO.target) <= COMMISSION_RATIO.tolerance),
  );
  check("importes redondeados y sin incumplimientos", commissionFixtureViolations().length === 0, commissionFixtureViolations());
  const bad = commissionFixtureViolations([
    { tier: "a", fixedPriceCents: 349900, fixedCommissionCents: 35000 },
    { tier: "b", fixedPriceCents: 600000, fixedCommissionCents: 60000 },
    { tier: "c", fixedPriceCents: 400000, fixedCommissionCents: 20000 },
  ]);
  check("el validador rechaza $3,499, $6,000 y una comisión del 5 %", bad.filter((v) => v.includes("fuera de")).length === 2 && bad.some((v) => v.includes("≈ 10 %")), bad);

  // ------------------------------------------------------------ preparación
  console.log(`\n· Preparando productos de prueba "${PREFIX} …" (vía la RPC del panel)`);
  const EX = await createTestProduct(admin.c, { name: `${PREFIX} EJEMPLO`, pricing: EXAMPLE_PRICING });
  created.products.push(EX.productId);
  const tiers = await createCommissionTestProducts(admin.c, PREFIX);
  created.products.push(...tiers.map((p) => p.productId));
  const byTier = Object.fromEntries(tiers.map((p) => [p.pricing.tier, p]));
  for (const p of [EX, ...tiers]) {
    const row = await productRow(p.productId);
    check(
      `${p.name.replace(PREFIX, "").trim()}: activo, precio fijo ${usd(row.default_reference_price_cents)} y comisión fija ${usd(row.default_base_commission_cents)} guardados`,
      row.is_active && row.default_reference_price_cents === p.pricing.fixedPriceCents && row.default_base_commission_cents === p.pricing.fixedCommissionCents &&
        (await missingAlertFor(p.productId)) === null,
      row,
    );
  }

  // ------------------------------------------------------------ 1-3
  console.log("\nTEST 1-3 · Precio fijo $4,500 · comisión fija $500");
  const S1 = await makeSale(EX.productId, EX.variantId, 450000);
  await soldWith("1 · vendido en $4,500", S1, seller, EXAMPLE_PRICING, 450000);
  const S2 = await makeSale(EX.productId, EX.variantId, 470000);
  const c2 = await soldWith("2 · vendido en $4,700", S2, admin, EXAMPLE_PRICING, 470000);
  check("2 · comisión final exactamente $600", c2?.final_commission_cents === 60000);
  const S3 = await makeSale(EX.productId, EX.variantId, 500000);
  const c3 = await soldWith("3 · vendido en $5,000", S3, seller, EXAMPLE_PRICING, 500000);
  check("3 · comisión final exactamente $750", c3?.final_commission_cents === 75000);
  console.log("  · redondeo: la parte del vendedor se redondea hacia abajo y el centavo restante es de la tienda");
  const S3a = await makeSale(EX.productId, EX.variantId, 450001);
  const c3a = await soldWith("vendido en $4,500.01", S3a, admin, EXAMPLE_PRICING, 450001);
  const S3b = await makeSale(EX.productId, EX.variantId, 470003);
  const c3b = await soldWith("vendido en $4,700.03", S3b, seller, EXAMPLE_PRICING, 470003);
  check("vendedor + tienda = adicional exacto (1¢ → 0¢ + 1¢ · $200.03 → $100.01 + $100.02)",
    c3a.seller_difference_share_cents === 0 && c3a.price_difference_cents - c3a.seller_difference_share_cents === 1 &&
    c3b.seller_difference_share_cents === 10001 && c3b.price_difference_cents - c3b.seller_difference_share_cents === 10002,
    { c3a: [c3a.price_difference_cents, c3a.seller_difference_share_cents], c3b: [c3b.price_difference_cents, c3b.seller_difference_share_cents] });
  const { data: ev } = await svc.from("commission_events").select("after").eq("sale_id", S3b).eq("event_type", "COMMISSION_CALCULATED").single();
  check("el evento de cálculo guarda la parte de la tienda", ev?.after?.storeShareCents === 10002 && ev?.after?.sellerShareCents === 10001, ev?.after);

  console.log("\n· Los 8 niveles de prueba: VENDIDA con precio fijo + adicional de $201.01");
  for (const t of COMMISSION_TEST_PRODUCTS) {
    const p = byTier[t.tier];
    const price = t.fixedPriceCents + 20101;
    const sid = await makeSale(p.productId, p.variantId, price);
    await soldWith(`N${t.tier} (${usd(t.fixedPriceCents)} / ${usd(t.fixedCommissionCents)})`, sid, t.tier % 2 ? seller : admin, t, price);
  }

  // ------------------------------------------------------------ 4
  console.log("\nTEST 4 · No se permite vender por debajo del precio fijo ($4,500)");
  const S4a = await makeSale(EX.productId, EX.variantId, 449999, { submit: false });
  await expectReviewBlocked("borrador a $4,499.99", S4a, "UNIT_PRICE_BELOW_FIXED_PRICE");
  // Producto aparte: el admin SUBE el precio fijo mientras la venta está pendiente.
  const EXB = await createTestProduct(admin.c, { name: `${PREFIX} EJEMPLO B`, pricing: EXAMPLE_PRICING });
  created.products.push(EXB.productId);
  const S4b = await makeSale(EXB.productId, EXB.variantId, 450000);
  await setTestProductPricing(admin.c, EXB.productId, { fixedPriceCents: 459900, fixedCommissionCents: 50000 });
  await expectBlocked("pendiente a $4,500 con precio fijo subido a $4,599", S4b, "UNIT_PRICE_BELOW_FIXED_PRICE");
  await setTestProductPricing(admin.c, EXB.productId, EXAMPLE_PRICING);
  const u4b = await unitOf(S4b);
  let r = await rpc(admin.c, "admin_update_cuba_sale", {
    p_sale_id: S4b, p_reason: "Descuento no autorizado",
    p_payload: { units: [{ id: u4b.id, productId: EXB.productId, variantId: EXB.variantId, agreedPriceCents: 449900 }] },
  });
  check("edición admin (PENDIENTE) a $4,499 → rechazada", r.ok === false && (r.errors ?? []).includes("UNIT_PRICE_BELOW_FIXED_PRICE") && (await unitOf(S4b)).agreed_price_cents === 450000, r);
  r = await rpc(admin.c, "admin_update_cuba_sale", { p_sale_id: S4b, p_reason: "Teléfono corregido", p_payload: { buyer: { phone: "(305) 555-0188" } } });
  check("edición admin no relacionada con el precio → permitida", r.ok === true, r);
  r = await rpc(seller.c, "request_sale_edit", {
    p_sale_id: S4b, p_reason: "Descuento al cliente",
    p_changes: [{ path: `units.${u4b.id}.agreed_price_cents`, oldValue: "450000", newValue: "449900" }],
  });
  check("solicitud del vendedor a $4,499 → rechazada al instante", r.ok === false && r.code === "UNIT_PRICE_BELOW_FIXED_PRICE" && r.fixedPriceCents === 450000, r);
  r = await rpc(seller.c, "request_sale_edit", {
    p_sale_id: S4b, p_reason: "El cliente pagará más",
    p_changes: [{ path: `units.${u4b.id}.agreed_price_cents`, oldValue: "450000", newValue: "480000" }],
  });
  check("solicitud del vendedor a $4,800 → creada", r.ok === true && Boolean(r.requestId), r);
  if (r.requestId) {
    created.requests.push(r.requestId);
    r = await rpc(admin.c, "approve_sale_edit_request", { p_request_id: r.requestId });
    check("aprobada por el admin: precio $4,800", r.ok === true && (await unitOf(S4b)).agreed_price_cents === 480000, r);
    // Cobertura exacta de nuevo (el pago se ajusta desde borrador en la vida real; aquí, dato de prueba propio).
    await svc.from("sale_payment_allocations").update({ net_amount_cents: 480000, gross_amount_cents: 480000 }).eq("sale_id", S4b);
    await soldWith("pendiente a $4,800 tras la solicitud aprobada", S4b, seller, EXAMPLE_PRICING, 480000);
  }
  const u2 = await unitOf(S2);
  r = await rpc(admin.c, "admin_update_cuba_sale", {
    p_sale_id: S2, p_reason: "Descuento posterior",
    p_payload: { units: [{ id: u2.id, productId: EX.productId, variantId: EX.variantId, agreedPriceCents: 449999 }] },
  });
  check("VENDIDA: corrección admin por debajo del precio fijo congelado → rechazada", r.ok === false && (r.errors ?? []).includes("UNIT_PRICE_BELOW_FIXED_PRICE"), r);
  r = await rpc(seller.c, "request_sale_edit", {
    p_sale_id: S2, p_reason: "Descuento posterior",
    p_changes: [{ path: `units.${u2.id}.agreed_price_cents`, oldValue: "470000", newValue: "440000" }],
  });
  check("VENDIDA: solicitud del vendedor por debajo del precio fijo congelado → rechazada", r.ok === false && r.code === "UNIT_PRICE_BELOW_FIXED_PRICE", r);

  // ------------------------------------------------------------ 5
  console.log("\nTEST 5 · No se permite vender si falta el precio fijo");
  const fresh = await createTestProduct(admin.c, { name: `${PREFIX} SIN CONFIG` });
  created.products.push(fresh.productId);
  const freshRow = await productRow(fresh.productId);
  check("producto nuevo: nace SIN precio fijo ni comisión fija (como en una instalación limpia)", freshRow.default_reference_price_cents === null && freshRow.default_base_commission_cents === null, freshRow);
  const freshAlert = await missingAlertFor(fresh.productId);
  check('producto nuevo: alerta "Comisión faltante" → /admin/productos/[id]', freshAlert?.actionUrl === `/admin/productos/${fresh.productId}` && freshAlert?.detail?.includes("precio fijo de venta o comisión fija"), freshAlert);
  await expectReviewBlocked("borrador con producto sin configurar", await makeSale(fresh.productId, fresh.variantId, 459900, { submit: false }), "UNIT_COMMISSION_CONFIG_MISSING");
  const p7 = byTier[7];
  const S5 = await makeSale(p7.productId, p7.variantId, 540000);
  const S5d = await makeSale(p7.productId, p7.variantId, 540000, { submit: false });
  await unsetTestProductValue(svc, p7.productId, "fixedPrice");
  check("sin precio fijo: aparece la alerta", (await missingAlertFor(p7.productId)) !== null);
  await expectReviewBlocked("sin precio fijo", S5d, "UNIT_COMMISSION_CONFIG_MISSING");
  await expectBlocked("sin precio fijo", S5, "COMMISSION_CONFIG_MISSING");

  // ------------------------------------------------------------ 6
  console.log("\nTEST 6 · No se permite vender si falta la comisión fija");
  const p8 = byTier[8];
  const S6 = await makeSale(p8.productId, p8.variantId, 599900);
  const S6d = await makeSale(p8.productId, p8.variantId, 599900, { submit: false });
  await unsetTestProductValue(svc, p8.productId, "fixedCommission");
  check("sin comisión fija: aparece la alerta", (await missingAlertFor(p8.productId)) !== null);
  await expectReviewBlocked("sin comisión fija", S6d, "UNIT_COMMISSION_CONFIG_MISSING");
  await expectBlocked("sin comisión fija", S6, "COMMISSION_CONFIG_MISSING");
  // El admin completa los valores (mismo camino que el panel) → se desbloquea.
  await setTestProductPricing(admin.c, p7.productId, p7.pricing);
  await setTestProductPricing(admin.c, p8.productId, p8.pricing);
  check("valores completados por el admin: desaparecen las alertas", (await missingAlertFor(p7.productId)) === null && (await missingAlertFor(p8.productId)) === null);
  await soldWith("completado el precio fijo", S5, seller, p7.pricing, 540000);
  await soldWith("completada la comisión fija", S6, admin, p8.pricing, 599900);

  // ------------------------------------------------------------ 7
  console.log("\nTEST 7 · Cambiar la configuración del producto no modifica comisiones históricas");
  const historic = [S1, S2, S3, S3a, S3b];
  const before = await commissionsOf(historic);
  await setTestProductPricing(admin.c, EX.productId, commissionTier(7)); // $5,299 / $550
  check("tras cambiar precio fijo y comisión fija del producto: las 5 comisiones siguen idénticas", same(await commissionsOf(historic), before), { antes: before.length });
  r = await rpc(admin.c, "admin_update_cuba_sale", { p_sale_id: S2, p_reason: "Corrección de teléfono", p_payload: { buyer: { phone: "(305) 555-0199" } } });
  check("editar otra información de la venta VENDIDA: comisiones idénticas", r.ok === true && same(await commissionsOf(historic), before), r);
  const S7n = await makeSale(EX.productId, EX.variantId, 529900);
  await soldWith("una venta NUEVA usa la configuración nueva ($5,299 / $550)", S7n, seller, commissionTier(7), 529900);
  const u3 = await unitOf(S3);
  r = await rpc(admin.c, "admin_update_cuba_sale", {
    p_sale_id: S3, p_reason: "Precio final corregido",
    p_payload: { units: [{ id: u3.id, productId: EX.productId, variantId: EX.variantId, agreedPriceCents: 510000 }] },
  });
  const [c3c] = await commissionsOf([S3]);
  check("corrección de precio (VENDIDA, $5,100): recalcula con SU snapshot $4,500/$500 → $800 (no con $5,299/$550)",
    r.ok === true && c3c.reference_price_cents === 450000 && c3c.base_commission_cents === 50000 && c3c.final_commission_cents === 80000, c3c);
  check("las comisiones que ya existían antes de la prueba siguen idénticas",
    same((await allCommissions()).filter((x) => baseline.commissions.some((b) => b.id === x.id)), baseline.commissions), { reales: baseline.commissions.length });

  // ------------------------------------------------------------ 8
  console.log("\nTEST 8 · El vendedor no puede editar el precio fijo ni la comisión fija");
  const exBefore = await productRow(EX.productId);
  r = await rpc(seller.c, "admin_update_product_commission_defaults", { p_product_id: EX.productId, p_default_reference_price_cents: 100000, p_default_base_commission_cents: 90000 });
  check("RPC del panel como vendedor → NOT_ADMIN", r.ok === false && r.code === "NOT_ADMIN", r);
  const { data: upd } = await seller.c.from("products")
    .update({ default_reference_price_cents: 100000, default_base_commission_cents: 90000 }).eq("id", EX.productId).select("id");
  check("escritura directa en la tabla como vendedor → sin efecto (RLS)", (upd ?? []).length === 0);
  check("el producto no cambió", same(await productRow(EX.productId), exBefore), await productRow(EX.productId));

  // ------------------------------------------------------------ 9
  console.log("\nTEST 9 · El administrador sí puede modificar ambos valores (con validación)");
  r = await rpc(admin.c, "admin_update_product_commission_defaults", { p_product_id: EX.productId, p_default_reference_price_cents: 480000, p_default_base_commission_cents: 50000 });
  const exAfter = await productRow(EX.productId);
  check("admin guarda $4,800 / $500", r.ok === true && exAfter.default_reference_price_cents === 480000 && exAfter.default_base_commission_cents === 50000, { r, exAfter });
  const { data: evs } = await svc.from("product_catalog_events").select("event_type, changes").eq("product_id", EX.productId).eq("event_type", "COMMISSION_DEFAULTS_UPDATED").order("created_at", { ascending: false }).limit(1);
  check("queda auditado (COMMISSION_DEFAULTS_UPDATED con valores antes/después)", evs?.[0]?.changes?.to?.defaultReferencePriceCents === 480000, evs?.[0]);
  for (const [label, price, commission, code] of [
    ["precio fijo vacío", null, 50000, "FIXED_PRICE_REQUIRED"],
    ["comisión fija vacía", 480000, null, "FIXED_COMMISSION_REQUIRED"],
    ["precio fijo $0", 0, 50000, "FIXED_PRICE_INVALID"],
    ["comisión fija $0", 480000, 0, "FIXED_COMMISSION_INVALID"],
    ["comisión fija negativa", 480000, -100, "FIXED_COMMISSION_INVALID"],
    ["comisión fija >= precio fijo", 480000, 480000, "FIXED_COMMISSION_TOO_HIGH"],
  ]) {
    r = await rpc(admin.c, "admin_update_product_commission_defaults", { p_product_id: EX.productId, p_default_reference_price_cents: price, p_default_base_commission_cents: commission });
    check(`${label} → ${code}`, r.ok === false && r.code === code, r);
  }
  check("tras los rechazos el producto conserva $4,800 / $500", same(await productRow(EX.productId), exAfter));

  // ------------------------------------------------------------ 10
  console.log("\nTEST 10 · Desglose de la ficha de venta (RPC de resumen, como vendedor dueño)");
  const sum = await rpc(seller.c, "sale_commission_summary", { p_sale_id: S2 });
  const it = sum.items?.[0];
  check("venta $4,700: precio fijo $4,500 · comisión fija $500 · adicional $200 · vendedor $100 · tienda $100 · total $600",
    it?.referencePriceCents === 450000 && it?.baseCommissionCents === 50000 && it?.salePriceCents === 470000 &&
      it?.priceDifferenceCents === 20000 && it?.sellerDifferenceShareCents === 10000 &&
      it.priceDifferenceCents - it.sellerDifferenceShareCents === 10000 && it?.finalCommissionCents === 60000 && sum.totalCents === 60000,
    it);
}

async function cleanupAndVerify() {
  console.log("\n· Limpiando datos de prueba");
  if (created.requests.length) await svc.from("sale_edit_requests").delete().in("id", created.requests);
  for (const id of created.sales) {
    const { error } = await svc.from("sales").delete().eq("id", id);
    if (error) console.log(`  ! venta ${id}: ${error.message}`);
  }
  for (const e of await deleteTestProducts(svc, created.products)) console.log(`  ! ${e}`);

  console.log("\nTEST 11 · Los valores temporales se eliminan al terminar");
  const none = ["00000000-0000-0000-0000-000000000000"];
  const { data: stillThere } = await svc.from("products").select("id").in("id", created.products.length ? created.products : none);
  check(`los ${created.products.length} productos de prueba (y sus valores) fueron eliminados`, (stillThere ?? []).length === 0, stillThere);
  const leftovers = await leftoverTestProducts(svc);
  check('no queda ningún producto de prueba "E2E …" en la base', leftovers.length === 0, leftovers);
  const { data: leftSales } = await svc.from("sales").select("id").in("id", created.sales.length ? created.sales : none);
  check(`las ${created.sales.length} ventas de prueba (y sus comisiones) fueron eliminadas`, (leftSales ?? []).length === 0, leftSales);
  const commissionsNow = await allCommissions();
  check(`comisiones: ninguna de prueba y las ${baseline.commissions.length} previas intactas`, same(commissionsNow, baseline.commissions), { antes: baseline.commissions.length, ahora: commissionsNow.length });
  check("eventos de catálogo: sin restos de la prueba", (await catalogEventCount()) === baseline.catalogEvents);

  console.log("\nTEST 12 · Ningún seed ni fixture de prueba modifica productos reales");
  if (baseline.products.length) {
    const realNow = await snapshotRealProducts(svc);
    check(
      `productos reales intactos (${realNow.length}: precio fijo, comisión fija, estado y fecha de modificación iguales que antes)`,
      same(realNow, baseline.products),
      realNow.filter((x) => !baseline.products.some((b) => same(b, x))),
    );
    const target = baseline.products[0];
    let refused = false;
    try {
      await unsetTestProductValue(svc, target.id, "fixedPrice");
    } catch {
      refused = true;
    }
    check("el helper de la fixture se niega a tocar un producto real", refused && same(await snapshotRealProducts(svc), baseline.products));
    const realActive = realNow.filter((p) => p.is_active);
    const unconfigured = realActive.filter((p) => !(p.default_reference_price_cents > 0 && p.default_base_commission_cents > 0));
    console.log(`    (productos reales activos: ${realActive.length} · sin configurar: ${unconfigured.length})`);
    const admin = await signIn(values.admin);
    const alerts = await rpc(admin.c, "admin_alerts_list", { p_category: "COMISIONES", p_limit: 200 });
    const missing = (alerts.items ?? []).filter((a) => a.type === "CONFIG_COMISION_FALTANTE");
    check(
      `alerta "Comisión faltante": una por cada producto real activo sin configurar (${unconfigured.length})`,
      missing.length === unconfigured.length && unconfigured.every((p) => missing.some((a) => a.entityId === p.id)),
      { alertas: missing.length, productos: unconfigured.length },
    );
  }
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const sqlFiles = [
    ...readdirSync(path.join(dir, "migrations")).filter((f) => f.endsWith(".sql")).map((f) => path.join(dir, "migrations", f)),
    ...["seed.sql"].map((f) => path.join(dir, f)).filter((f) => existsSync(f)),
  ];
  const fixtureNumbers = new RegExp(`\\b(${[...COMMISSION_TEST_PRODUCTS, EXAMPLE_PRICING].map((t) => t.fixedPriceCents).join("|")})\\b`);
  const offenders = sqlFiles.filter((f) => {
    const sql = readFileSync(f, "utf8");
    return /default_(reference_price|base_commission)_cents\s*=\s*\d/i.test(sql) ||
      /insert\s+into\s+(public\.)?products\b[^;]*default_(reference_price|base_commission)_cents/i.test(sql) ||
      fixtureNumbers.test(sql);
  });
  check(`ninguna migración ni seed asigna precio fijo o comisión fija (${sqlFiles.length} archivos revisados)`, offenders.length === 0, offenders.map((f) => path.basename(f)));
}

try {
  await main();
} catch (e) {
  fail++;
  console.log(`\n✘ ERROR: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  try {
    await cleanupAndVerify();
  } catch (e) {
    fail++;
    console.log(`\n✘ ERROR en la limpieza: ${e instanceof Error ? e.message : String(e)}`);
  }
  console.log(`\nResultado: ${pass} ok · ${fail} fallos`);
  process.exit(fail ? 1 : 0);
}
