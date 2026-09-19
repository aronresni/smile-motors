/**
 * Integración REAL (contra la base) de la simplificación "sin VIN ni stock
 * físico" (migración 20260918120000):
 *   1. venta sin VIN · 2. PENDING→SOLD sin VIN · 3. comisión por PRODUCTO
 *   ($3,999 ref / $400 base, venta $4,399 → $600) · 4. comisión histórica
 *   INVENTORY_UNIT intacta · 5. cambio de config: la vieja no cambia, la
 *   nueva la usa · 6. logística + seguimiento sin VIN.
 *   + búsqueda global sin VIN / con financiera, alertas de comisión por
 *   producto, reporte de productos sin stock, actividad sin inventario.
 *
 * Uso:
 *   node --env-file=.env.local supabase/scripts/test-no-vin-stock.mjs \
 *     --admin e2e-smile-admin@motods.test --seller e2e-smile-seller@motods.test
 *
 * Crea y elimina sus propios datos. La única escritura con service_role es
 * la simulación explícita de UNA comisión histórica (caso 4) sobre datos de
 * prueba propios. Precio de referencia y comisión base: SOLO valores de prueba
 * temporales de `fixtures/commission-test-products.mjs` (N3 y N4).
 */
import { createClient } from "@supabase/supabase-js";
import { parseArgs } from "node:util";
import { commissionTier } from "./fixtures/commission-test-products.mjs";

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
const today = new Date().toISOString().slice(0, 10);
const created = { sales: [], products: [] };
const ZELLE = "2ab4abc7-f6a4-41a9-84b0-e0d2d0668fce";

async function main() {
  const admin = await signIn(values.admin);
  const seller = await signIn(values.seller);
  const stamp = Date.now().toString(36).toUpperCase();

  // Catálogo de prueba con valores temporales del nivel N3: referencia $3,999 · base $400.
  const T3 = commissionTier(3);
  const T4 = commissionTier(4);
  const pr = await rpc(admin.c, "admin_create_product", {
    p_name: `E2E NOVIN ${stamp}`, p_brand: "E2E", p_category: "Moto",
    p_base_price_cents: T3.fixedPriceCents, p_cuba_total_cents: T3.fixedPriceCents, p_is_active: true,
  });
  const P = pr.productId;
  if (!P) throw new Error(`admin_create_product: ${JSON.stringify(pr)}`);
  created.products.push(P);
  const V = (await rpc(admin.c, "admin_create_product_variant", { p_product_id: P, p_color_name: "Negro E2E" })).variantId;
  let cfg = await rpc(admin.c, "admin_update_product_commission_defaults", {
    p_product_id: P, p_default_reference_price_cents: T3.fixedPriceCents, p_default_base_commission_cents: T3.fixedCommissionCents,
  });
  if (!cfg.ok) throw new Error(`config: ${JSON.stringify(cfg)}`);

  async function makeSale(priceCents, submit = true) {
    const { data: saleId, error } = await seller.c.rpc("create_sale_draft", { p_operation_type: "CUBA" });
    if (error) throw new Error(error.message);
    created.sales.push(saleId);
    const saved = await rpc(seller.c, "save_cuba_sale_draft", {
      p_sale_id: saleId,
      p_payload: {
        saleDate: today, shareCommission: false, internalNotes: "E2E sin VIN",
        buyer: {
          firstName: "E2E", lastName: "SinVin", dateOfBirth: "1990-01-01", documentNumber: "E2E-NV-1",
          documentExpiration: "2031-01-01", phone: "(305) 555-0102", email: "", addressLine1: "1 Test St",
          addressLine2: "", city: "Miami", state: "FL", postalCode: "33101",
        },
        coBuyer: null,
        units: [{ productId: P, variantId: V, agreedPriceCents: priceCents }],
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
  const unitsOf = async (id) => (await svc.from("sale_units").select("*").eq("sale_id", id).order("position")).data ?? [];
  const commissionOf = async (unitId) => (await svc.from("sale_commissions").select("*").eq("sale_unit_id", unitId).single()).data;
  const invBefore = (await svc.from("inventory_units").select("id, status, updated_at")).data ?? [];

  // ---------------------------------------------------------------- 1
  console.log("\nTEST 1 · Crear venta sin VIN");
  const S1 = await makeSale(439900);
  const [u1] = await unitsOf(S1);
  check("venta creada y enviada a revisión sin VIN ni inventario", (await saleRow(S1)).status === "PENDING" && u1.inventory_unit_id === null, { status: (await saleRow(S1)).status });

  // ---------------------------------------------------------------- 2 + 3
  console.log("\nTEST 2 · PENDING → SOLD sin VIN (contratos y comisión válidos)");
  let r = await rpc(seller.c, "mark_sale_sold", { p_sale_id: S1 });
  check("marcada VENDIDA", r.ok === true && (await saleRow(S1)).status === "SOLD", r);
  console.log("\nTEST 3 · Comisión desde el PRODUCTO (ref $3,999 · base $400 · venta $4,399)");
  const c1 = await commissionOf(u1.id);
  check("comisión = $600 (60000 centavos)", c1?.final_commission_cents === 60000, c1);
  check("origen PRODUCT + snapshot ref/base del producto", c1?.source_type === "PRODUCT" && c1?.source_id === P && c1?.reference_price_cents === 399900 && c1?.base_commission_cents === 40000, c1);

  // ---------------------------------------------------------------- 4
  console.log("\nTEST 4 · Comisión histórica INVENTORY_UNIT intacta");
  const S4 = await makeSale(419900);
  const [u4] = await unitsOf(S4);
  r = await rpc(seller.c, "mark_sale_sold", { p_sale_id: S4 });
  // Simula un registro histórico (antes de esta tarea) sobre datos de prueba propios.
  await svc.from("sale_commissions").update({
    source_type: "INVENTORY_UNIT", source_id: null, reference_price_cents: 379900, base_commission_cents: 40000,
    price_difference_cents: 40000, seller_difference_share_cents: 20000, final_commission_cents: 60000,
  }).eq("sale_unit_id", u4.id);
  const hist = await commissionOf(u4.id);
  await rpc(admin.c, "admin_update_product_commission_defaults", {
    p_product_id: P, p_default_reference_price_cents: T4.fixedPriceCents, p_default_base_commission_cents: T4.fixedCommissionCents,
  });
  r = await rpc(admin.c, "admin_update_cuba_sale", {
    p_sale_id: S4, p_reason: "Corrección de teléfono", p_payload: { buyer: { phone: "(305) 555-0177" } },
  });
  check("edición no financiera de la venta histórica: ok", r.ok === true, r);
  const hist2 = await commissionOf(u4.id);
  check("comisión histórica sin cambios (origen, ref, base, final)", JSON.stringify([hist2.source_type, hist2.reference_price_cents, hist2.base_commission_cents, hist2.final_commission_cents, hist2.status]) === JSON.stringify([hist.source_type, hist.reference_price_cents, hist.base_commission_cents, hist.final_commission_cents, hist.status]), { hist, hist2 });

  // ---------------------------------------------------------------- 5
  console.log("\nTEST 5 · Cambio de config del producto: la vieja no cambia, la nueva sí la usa");
  const c1b = await commissionOf(u1.id);
  check("comisión VENDIDA anterior intacta tras cambiar la config", c1b.final_commission_cents === 60000 && c1b.reference_price_cents === 399900 && c1b.base_commission_cents === 40000, c1b);
  const S5 = await makeSale(440000);
  const [u5] = await unitsOf(S5);
  r = await rpc(admin.c, "mark_sale_sold", { p_sale_id: S5 });
  const c5 = await commissionOf(u5.id);
  // ref $4,299 / base $450 / venta $4,400 → 45000 + trunc(10100/2) = 50050 centavos
  check("venta nueva usa la config nueva (ref $4,299 · base $450 → $500.50)", r.ok === true && c5?.final_commission_cents === 50050 && c5?.reference_price_cents === 429900 && c5?.source_type === "PRODUCT", c5);

  // ---------------------------------------------------------------- 6
  console.log("\nTEST 6 · Logística y seguimiento sin VIN");
  const [u1s] = await unitsOf(S1);
  check("código de seguimiento generado al vender", /^CU-/.test(u1s.tracking_code ?? ""), u1s.tracking_code);
  const { data: log0 } = await svc.from("sale_unit_logistics").select("status").eq("sale_unit_id", u1.id).single();
  check("logística inicializada PENDING_PREPARATION", log0?.status === "PENDING_PREPARATION", log0);
  r = await rpc(admin.c, "admin_logistics_update_status", { p_sale_unit_id: u1.id, p_new_status: "READY" });
  check("avanza a READY (ciclo intacto)", r.ok === true, r);
  r = await rpc(admin.c, "admin_logistics_update_status", { p_sale_unit_id: u1.id, p_new_status: "DISPATCHED" });
  check("avanza a DISPATCHED", r.ok === true, r);
  r = await rpc(admin.c, "admin_logistics_update_status", { p_sale_unit_id: u1.id, p_new_status: "DELIVERED" });
  check("salto de pasos sigue bloqueado", r.ok === false, r);
  const st = await rpc(seller.c, "sale_unit_logistics_status", { p_sale_id: S1 });
  const row = Array.isArray(st) ? st[0] : (st.items ?? st.units ?? [])[0];
  check("lectura del vendedor: seguimiento + estado, sin campo VIN", row && row.trackingCode === u1s.tracking_code && row.status === "DISPATCHED" && !("vin" in row), row);
  const list = await rpc(admin.c, "admin_logistics_list", { p_search: u1s.tracking_code });
  check("listado de logística encuentra por seguimiento, sin VIN", list.ok === true && list.items?.length === 1 && !("vin" in list.items[0]), list.items?.[0]);

  // ---------------------------------------------------------------- extras
  console.log("\nEXTRA · búsqueda, alertas, reportes, actividad y datos legados");
  const sale1 = await saleRow(S1);
  r = await rpc(admin.c, "admin_global_search", { p_query: sale1.sale_number });
  check("búsqueda: encuentra por número y no devuelve VIN", r.ok === true && r.sales?.some((x) => x.id === S1) && !("units" in r), Object.keys(r));
  r = await rpc(admin.c, "admin_global_search", { p_query: "Zelle" });
  check("búsqueda: encuentra por financiera", r.ok === true && r.sales?.some((x) => x.id === S1 && /zelle/i.test(x.provider ?? "")), r.sales?.find((x) => x.id === S1));
  r = await rpc(admin.c, "admin_global_search", { p_query: "H0DPB" });
  check("búsqueda: un VIN legado ya no devuelve resultados de inventario", r.ok === true && !("units" in r), r);
  const sum = await rpc(admin.c, "admin_alerts_summary", {});
  check("alertas: sin categoría INVENTARIO", sum.ok === true && !("INVENTARIO" in (sum.categories ?? {})), sum.categories);
  const alerts = await rpc(admin.c, "admin_alerts_list", { p_category: "COMISIONES", p_limit: 100 });
  const missing = (alerts.items ?? []).filter((a) => a.type === "CONFIG_COMISION_FALTANTE");
  // Puede haber 0 alertas si todos los productos reales ya están configurados;
  // la alerta con un producto sin configurar se prueba en test-commission-fixtures.mjs.
  check("alertas de comisión (si hay) apuntan a /admin/productos/[id]", missing.every((a) => String(a.destinationUrl ?? a.actionUrl ?? "").startsWith("/admin/productos/")), missing[0]);
  const { count: activeMissing } = await svc.from("products").select("id", { count: "exact", head: true })
    .eq("is_active", true).or("default_reference_price_cents.is.null,default_base_commission_cents.is.null");
  check("una alerta por producto activo sin config", missing.length === activeMissing, { alertas: missing.length, productos: activeMissing });
  const rep = await rpc(admin.c, "admin_reports_products", { p_start: null, p_end: null });
  const repRow = (rep.items ?? []).find((x) => x.productId === P);
  check("reporte de productos: ventas/comisión, sin stock", repRow && repRow.unitsSold >= 2 && repRow.commissionGeneratedCents > 0 && !("currentAvailableStock" in repRow) && !("isOnDemand" in repRow), repRow);
  const pl = await rpc(admin.c, "admin_product_list", { p_search: `E2E NOVIN ${stamp}` });
  const plRow = pl.items?.[0];
  check("lista de productos: comisión del producto, sin conteos de stock", plRow && plRow.defaultReferencePriceCents === 429900 && !("availableCount" in plRow) && !("stockMode" in plRow), plRow);
  const pd = await rpc(admin.c, "admin_product_detail", { p_product_id: P });
  check("ficha de producto: sin resumen de inventario ni cantidades", pd.ok === true && !("inventorySummary" in pd) && !("quantityReported" in (pd.variants?.[0] ?? {})) && !("vinCount" in (pd.variants?.[0] ?? {})), Object.keys(pd));
  const feed = await rpc(admin.c, "admin_activity_feed", { p_category: "ALL", p_limit: 100 });
  check("actividad: sin eventos de inventario", feed.ok === true && !(feed.items ?? []).some((i) => i.category === "INVENTARIO"), (feed.items ?? []).filter((i) => i.category === "INVENTARIO").length);
  const invAfter = (await svc.from("inventory_units").select("id, status, updated_at")).data ?? [];
  check("datos legados de VIN intactos (43 filas, sin cambios)", JSON.stringify(invAfter.sort((a, b) => a.id.localeCompare(b.id))) === JSON.stringify(invBefore.sort((a, b) => a.id.localeCompare(b.id))), { antes: invBefore.length, despues: invAfter.length });
}

async function cleanup() {
  console.log("\n· Limpiando datos de prueba");
  for (const id of created.sales) {
    const { error } = await svc.from("sales").delete().eq("id", id);
    if (error) console.log(`  ! venta ${id}: ${error.message}`);
  }
  for (const id of created.products) {
    await svc.from("product_catalog_events").delete().eq("product_id", id);
    await svc.from("product_variants").delete().eq("product_id", id);
    const { error } = await svc.from("products").delete().eq("id", id);
    if (error) console.log(`  ! producto ${id}: ${error.message}`);
  }
}

try {
  await main();
} catch (e) {
  fail++;
  console.log(`\n✘ ERROR: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  await cleanup();
  console.log(`\nResultado: ${pass} ok · ${fail} fallos`);
  process.exit(fail ? 1 : 0);
}
