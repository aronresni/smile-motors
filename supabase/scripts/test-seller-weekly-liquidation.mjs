/**
 * Integración REAL de la liquidación semanal con la regla "la comisión se
 * liquida al quedar la venta VENDIDA" (migraciones 20260920120000,
 * 20260921120000 y 20260921120100). Casos pedidos:
 *    1. una PENDIENTE aparece en el panel
 *    2. una PENDIENTE aparece en "Próximas a confirmar"
 *    3. su comisión se muestra como ESTIMADA
 *    4. no aumenta el total a liquidar
 *    5. no cuenta como unidad vendida
 *    6. al pasar a VENDIDA sale de las pendientes
 *    7. al pasar a VENDIDA su comisión congelada aumenta el total
 *    8. la comisión entra en la semana de CONFIRMACIÓN (no en la de creación)
 *    9. la misma venta nunca se incluye dos veces
 *   10. no hace falta esperar a PAGADA
 *   11. ventas, comisiones y liquidaciones reales intactas
 *   12. permisos entre vendedores protegidos (y el admin con acceso completo)
 *   + totales del vendedor = listado del admin · varias unidades una sola vez ·
 *     CANCELADA sin comisión · comisión liquidada bloqueada · bonos aprobados.
 *
 * Uso:
 *   npm run test:weekly -- --admin e2e-smile-admin@motods.test \
 *     --seller e2e-smile-seller@motods.test
 *
 * Crea y elimina sus propios datos (productos "E2E …", ventas, liquidaciones y
 * un segundo vendedor de prueba). service_role solo lee, limpia y —porque no
 * existe un flujo de cancelación— marca CANCELADA una venta de prueba propia.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import {
  EXAMPLE_PRICING,
  commissionTier,
  createTestProduct,
  deleteTestProducts,
  setTestProductPricing,
} from "./fixtures/commission-test-products.mjs";

const { values } = parseArgs({
  options: { admin: { type: "string" }, seller: { type: "string" }, password: { type: "string", default: process.env.E2E_PASSWORD } },
});
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON || !SERVICE || !values.admin || !values.seller || !values.password) {
  console.error("Faltan variables de entorno, --admin/--seller o E2E_PASSWORD (.env.local)");
  process.exit(1);
}
const SELLER2 = "e2e-smile-seller2@motods.test";
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
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ZELLE = "2ab4abc7-f6a4-41a9-84b0-e0d2d0668fce";
const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const created = { sales: [], products: [], liquidations: [], sellerIds: [] };
const baseline = {};

async function realSnapshot(testSellerIds) {
  const notTest = (q) => (testSellerIds.length ? q.not("seller_id", "in", `(${testSellerIds.join(",")})`) : q);
  const [sales, commissions, liquidations, adjustments] = await Promise.all([
    notTest(svc.from("sales").select("*").order("id")),
    notTest(svc.from("sale_commissions").select("*").order("id")),
    notTest(svc.from("weekly_liquidations").select("*").order("id")),
    svc.from("weekly_liquidation_adjustments").select("*").order("id"),
  ]);
  return { sales: sales.data, commissions: commissions.data, liquidations: liquidations.data, adjustments: adjustments.data };
}

async function main() {
  const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  execFileSync("node", ["--env-file=.env.local", "supabase/scripts/create-user.mjs", "--email", SELLER2, "--password", values.password, "--role", "seller", "--name", "Vendedor Smile E2E 2"], { cwd, stdio: "ignore" });
  const admin = await signIn(values.admin);
  const seller = await signIn(values.seller);
  const seller2 = await signIn(SELLER2);
  created.sellerIds.push(seller.id, seller2.id);
  Object.assign(baseline, await realSnapshot(created.sellerIds));

  const stamp = Date.now().toString(36).toUpperCase();
  const P = await createTestProduct(admin.c, { name: `E2E SEMANAL ${stamp} A`, pricing: EXAMPLE_PRICING }); // $4,500 / $500
  const Q = await createTestProduct(admin.c, { name: `E2E SEMANAL ${stamp} B`, pricing: commissionTier(1) }); // $3,500 / $350
  created.products.push(P.productId, Q.productId);

  const W = (await rpc(seller.c, "seller_weekly_liquidation", {})).currentWeekStart;
  const weekOf = (w, by = seller) => rpc(by.c, "seller_weekly_liquidation", { p_week_start: w });
  const row = (list, id) => (list ?? []).find((r) => r.saleId === id);
  const adminRow = async (w) =>
    ((await rpc(admin.c, "admin_liquidation_week_list", { p_week_start: w })).rows ?? []).find((r) => r.sellerId === seller.id);

  async function makeSale({ units, saleDate = W, submit = true, by = seller, buyer = "Semanal" }) {
    const { data: saleId, error } = await by.c.rpc("create_sale_draft", { p_operation_type: "CUBA" });
    if (error) throw new Error(error.message);
    created.sales.push(saleId);
    const total = units.reduce((a, u) => a + u.price, 0);
    const saved = await rpc(by.c, "save_cuba_sale_draft", {
      p_sale_id: saleId,
      p_payload: {
        saleDate, shareCommission: false, internalNotes: "Venta de prueba semanal",
        buyer: {
          firstName: "E2E", lastName: `${buyer} ${stamp}`, dateOfBirth: "1990-01-01", documentNumber: "E2E-WK-1",
          documentExpiration: "2031-01-01", phone: "(305) 555-0107", email: "", addressLine1: "1 Test St",
          addressLine2: "", city: "Miami", state: "FL", postalCode: "33101",
        },
        coBuyer: null,
        units: units.map((u) => ({ productId: u.p.productId, variantId: u.p.variantId, agreedPriceCents: u.price })),
        extras: [],
        cubaRecipient: {
          fullName: "Destinatario E2E", identityNumber: "90010112345", deliveryAddress: "Calle 1 #2",
          municipality: "Plaza", province: "La Habana", phonePrimary: "+53 55555555", phoneSecondary: "",
        },
        delivery: { method: "HOME_DELIVERY", reference: "" },
        paymentAllocations: [{ id: null, paymentMethodId: ZELLE, planId: null, inputMode: "NET", amountCents: total, reference: "E2E", notes: "" }],
      },
    });
    if (saved && saved.ok === false) throw new Error(`save: ${JSON.stringify(saved)}`);
    for (const [subject, side] of [["BUYER", "FRONT"], ["BUYER", "BACK"], ["CUBA_RECIPIENT", "FRONT"], ["CUBA_RECIPIENT", "BACK"]]) {
      await by.c.rpc("record_sale_document", {
        p_sale_id: saleId, p_subject_type: subject, p_side: side,
        p_storage_path: `${by.id}/${saleId}/${subject.toLowerCase()}-${side.toLowerCase()}.jpg`, p_mime_type: "image/jpeg", p_file_size_bytes: 1000,
      });
    }
    if (submit) {
      const r = await rpc(by.c, "request_sale_review", { p_sale_id: saleId });
      if (!r.ok) throw new Error(`review: ${JSON.stringify(r)}`);
    }
    return saleId;
  }
  async function payInFull(saleId) {
    const { data: allocs } = await svc.from("sale_payment_allocations").select("id").eq("sale_id", saleId);
    for (const a of allocs ?? []) await rpc(admin.c, "mark_payment_allocation_settled", { p_allocation_id: a.id });
    return rpc(admin.c, "admin_mark_sale_paid", { p_sale_id: saleId });
  }

  // ---------------------------------------------------------------- datos
  const D = await makeSale({ units: [{ p: P, price: 470000 }], submit: false, buyer: "Borrador" });
  const S = await makeSale({ units: [{ p: P, price: 470000 }], buyer: "Pendiente" });                     // $600 est.
  const OLD = await makeSale({ units: [{ p: P, price: 450000 }], saleDate: addDays(W, -14), buyer: "Antigua" }); // $500 est.
  const M = await makeSale({ units: [{ p: P, price: 470000 }, { p: Q, price: 360000 }], buyer: "Multi" }); // $600 + $400

  // ---------------------------------------------------------------- 1-5
  console.log("\n1-5 · PENDIENTE: visible, estimada y fuera de la liquidación");
  const list = await rpc(seller.c, "seller_sales_list", { p_search: stamp, p_limit: 50 });
  const listed = (id) => (list.items ?? []).find((i) => i.saleId === id);
  check("1 · la PENDIENTE (y el BORRADOR) aparecen en el panel", listed(S)?.status === "PENDING" && listed(D)?.status === "DRAFT");
  let wk = await weekOf(W);
  check("2 · la PENDIENTE aparece en 'Próximas a confirmar' (no en confirmadas)", Boolean(row(wk.upcoming, S)) && !row(wk.confirmedSales, S));
  check("   la antigua aparece en 'Próximas a confirmar de semanas anteriores' y sigue la semana siguiente",
    Boolean(row(wk.upcomingPrevious, OLD)) && Boolean(row((await weekOf(addDays(W, 7))).upcomingPrevious, OLD)));
  check("   el BORRADOR no está en la liquidación semanal (solo en el panel)", !row(wk.upcoming, D) && !row(wk.confirmedSales, D));
  check("3 · comisión de la pendiente = ESTIMADA $600", row(wk.upcoming, S)?.commission?.kind === "ESTIMATED" && row(wk.upcoming, S)?.commission?.totalCents === 60000);
  check("4 · no aumenta el total a liquidar ($0); el potencial se informa aparte ($2,100)",
    wk.summary.totalToPayCents === 0 && wk.summary.confirmedCommissionsCents === 0 && wk.summary.upcomingCount === 3 && wk.summary.upcomingEstimatedCents === 210000, wk.summary);
  check("5 · no cuenta como unidad vendida (0)", wk.summary.unitsSold === 0);
  const { count: early } = await svc.from("sale_commissions").select("id", { count: "exact", head: true }).in("sale_id", [D, S, OLD, M]);
  check("   no se creó ninguna comisión definitiva para pendientes/borradores", early === 0, early);

  // ---------------------------------------------------------------- 6-7, 10
  console.log("\n6-7 · Al pasar a VENDIDA (sin esperar a PAGADA)");
  let r = await rpc(seller.c, "mark_sale_sold", { p_sale_id: S });
  const { data: cS } = await svc.from("sale_commissions").select("*").eq("sale_id", S).single();
  wk = await weekOf(W);
  check("6 · sale de 'Próximas a confirmar' y pasa a 'Ventas confirmadas'", r.ok === true && !row(wk.upcoming, S) && row(wk.confirmedSales, S)?.status === "SOLD");
  check("7 · su comisión CONGELADA ($600) aumenta el total: $600 · 1 unidad",
    cS?.final_commission_cents === 60000 && wk.summary.confirmedCommissionsCents === 60000 && wk.summary.totalToPayCents === 60000 && wk.summary.unitsSold === 1 &&
      row(wk.confirmedSales, S)?.countedThisWeekCents === 60000, wk.summary);
  check("10 · no hizo falta PAGADA: la venta sigue VENDIDA (cliente sin pagar) y ya suma", (await svc.from("sales").select("status").eq("id", S).single()).data.status === "SOLD" && cS.status === "PENDING");
  await setTestProductPricing(admin.c, P.productId, { fixedPriceCents: 459900, fixedCommissionCents: 45000 });
  check("   cambiar el producto después no altera la comisión congelada ($600)", (await weekOf(W)).summary.confirmedCommissionsCents === 60000);
  await setTestProductPricing(admin.c, P.productId, EXAMPLE_PRICING);

  // ---------------------------------------------------------------- 8
  console.log("\n8 · La comisión entra en la semana de CONFIRMACIÓN");
  r = await rpc(admin.c, "mark_sale_sold", { p_sale_id: OLD });
  wk = await weekOf(W);
  const wkOld = await weekOf(addDays(W, -14));
  check("8 · la venta creada hace 2 semanas se confirma hoy → cuenta en ESTA semana ($600 + $500)",
    r.ok === true && Boolean(row(wk.confirmedSales, OLD)) && wk.summary.confirmedCommissionsCents === 110000 && wk.summary.unitsSold === 2, wk.summary);
  check("   y no en la semana en que se creó; ya no figura como pendiente",
    wkOld.summary.totalToPayCents === 0 && !row(wkOld.confirmedSales, OLD) && !row(wk.upcomingPrevious, OLD) && !row(wkOld.upcoming, OLD));

  // Varias unidades: una fila, total una vez, 2 unidades.
  await rpc(seller.c, "mark_sale_sold", { p_sale_id: M });
  wk = await weekOf(W);
  const rm = row(wk.confirmedSales, M);
  check("   varias unidades: UNA fila con total $8,300 una sola vez; 2 unidades y comisión $1,000 ($600 + $400)",
    wk.confirmedSales.filter((x) => x.saleId === M).length === 1 && rm?.saleTotalCents === 830000 && rm?.commission?.units?.length === 2 &&
      rm.commission.totalCents === 100000 && wk.summary.unitsSold === 4 && wk.summary.confirmedCommissionsCents === 210000, { rm, s: wk.summary });

  // ---------------------------------------------------------------- 9 + admin = vendedor
  console.log("\n9 · Nunca dos veces · el admin y el vendedor ven el mismo total");
  let ar = await adminRow(W);
  check("   listado del admin (sin liquidación) = vendedor: $2,100 · 4 comisiones", ar?.subtotalCents === 210000 && ar?.totalCents === 210000 && ar?.eligibleCommissionsCount === 4, ar);
  // Solicitud de cambio de precio creada ANTES de que la comisión entre en una liquidación…
  const { data: uS1 } = await svc.from("sale_units").select("id").eq("sale_id", S).single();
  const reqBefore = await rpc(seller.c, "request_sale_edit", {
    p_sale_id: S, p_reason: "Precio corregido antes de liquidar",
    p_changes: [{ path: `units.${uS1.id}.agreed_price_cents`, oldValue: "470000", newValue: "480000" }],
  });
  const d1 = await rpc(admin.c, "admin_liquidation_create_draft", { p_seller_id: seller.id, p_week_start: W });
  // …y aprobada DESPUÉS: el motor la rechaza (la comisión ya está liquidada).
  const apr = await rpc(admin.c, "approve_sale_edit_request", { p_request_id: reqBefore.requestId });
  const { data: uS1After } = await svc.from("sale_units").select("agreed_price_cents").eq("id", uS1.id).single();
  check("   aprobar tarde un cambio de precio sobre una comisión ya liquidada falla (COMMISSION_LOCKED) y el precio no cambia",
    reqBefore.ok === true && apr.ok === false && apr.code === "APPLY_FAILED" && (apr.detail?.errors ?? []).includes("COMMISSION_LOCKED") &&
      uS1After.agreed_price_cents === 470000, { reqBefore, apr });
  await rpc(admin.c, "reject_sale_edit_request", { p_request_id: reqBefore.requestId, p_review_note: "Comisión ya liquidada" });
  if (d1.liquidationId) created.liquidations.push(d1.liquidationId);
  const d2 = await rpc(admin.c, "admin_liquidation_create_draft", { p_seller_id: seller.id, p_week_start: W });
  const d3 = await rpc(admin.c, "admin_liquidation_create_draft", { p_seller_id: seller.id, p_week_start: addDays(W, -7) });
  if (d3.liquidationId) created.liquidations.push(d3.liquidationId);
  check("9 · el borrador reclama las 4 comisiones una vez; repetirlo u otra semana reclama 0", d1.claimedCount === 4 && d2.claimedCount === 0 && d3.claimedCount === 0, { d1, d2, d3 });
  r = await payInFull(S);
  wk = await weekOf(W);
  ar = await adminRow(W);
  check("   al quedar PAGADA no se vuelve a sumar: vendedor $2,100 = admin $2,100",
    r.ok === true && wk.summary.totalToPayCents === 210000 && ar?.subtotalCents === 210000 && row(wk.confirmedSales, S)?.status === "PAID", { s: wk.summary, ar });
  const next = await weekOf(addDays(W, 7));
  check("   la semana siguiente no incluye ninguna de estas comisiones", next.summary.totalToPayCents === 0 && next.confirmedSales.length === 0);
  const det = await rpc(admin.c, "admin_liquidation_detail", { p_liquidation_id: d1.liquidationId });
  check("   el detalle del admin lista las 4 comisiones (mismas que suma el vendedor)", (det.commissionItems ?? []).length === 4 &&
    det.commissionItems.reduce((a, x) => a + x.finalCommissionCents, 0) === wk.summary.confirmedCommissionsCents);

  // Una comisión ya incluida en una liquidación no cambia de precio.
  const { data: uS } = await svc.from("sale_units").select("id").eq("sale_id", M).order("position").limit(1).single();
  r = await rpc(admin.c, "admin_update_cuba_sale", {
    p_sale_id: M, p_reason: "Precio corregido",
    p_payload: { units: [{ id: uS.id, productId: P.productId, variantId: P.variantId, agreedPriceCents: 480000 }, (await svc.from("sale_units").select("id, product_id, product_variant_id, agreed_price_cents").eq("sale_id", M).order("position")).data.slice(1).map((u) => ({ id: u.id, productId: u.product_id, variantId: u.product_variant_id, agreedPriceCents: u.agreed_price_cents }))[0]] },
  });
  check("   comisión liquidada: el admin no puede cambiar el precio (COMMISSION_LOCKED)", r.ok === false && r.code === "COMMISSION_LOCKED", r);
  r = await rpc(seller.c, "request_sale_edit", {
    p_sale_id: M, p_reason: "Precio corregido", p_changes: [{ path: `units.${uS.id}.agreed_price_cents`, oldValue: "470000", newValue: "480000" }],
  });
  check("   ni el vendedor puede solicitarlo (COMMISSION_LOCKED)", r.ok === false && r.code === "COMMISSION_LOCKED", r);

  // Bonos confirmados: solo en una liquidación APROBADA (semana anterior, cerrada).
  await rpc(admin.c, "admin_liquidation_add_adjustment", { p_liquidation_id: d3.liquidationId, p_type: "BONO_MARKETING", p_amount_cents: 10000, p_reason: "Bono de marketing E2E" });
  await rpc(admin.c, "admin_liquidation_add_adjustment", { p_liquidation_id: d3.liquidationId, p_type: "BONO_VENTAS", p_amount_cents: 5000, p_reason: "Bono de ventas E2E" });
  let prevWk = await weekOf(addDays(W, -7));
  check("   bonos de una liquidación en BORRADOR no se muestran al vendedor", prevWk.summary.bonusMarketingCents === 0 && prevWk.liquidation === null);
  r = await rpc(admin.c, "admin_liquidation_approve", { p_liquidation_id: d3.liquidationId });
  prevWk = await weekOf(addDays(W, -7));
  ar = await adminRow(addDays(W, -7));
  check("   APROBADA: marketing $100 + ventas $50 = total $150 (igual en el listado del admin)",
    r.ok === true && prevWk.summary.isFinal && prevWk.summary.bonusMarketingCents === 10000 && prevWk.summary.bonusSalesCents === 5000 &&
      prevWk.summary.totalToPayCents === 15000 && ar?.totalCents === 15000, { s: prevWk.summary, ar });

  // CANCELADA
  const C = await makeSale({ units: [{ p: P, price: 480000 }], saleDate: addDays(W, -21), buyer: "Cancelada" });
  await svc.from("sales").update({ status: "CANCELLED" }).eq("id", C).eq("seller_id", seller.id);
  r = await rpc(seller.c, "mark_sale_sold", { p_sale_id: C });
  const { count: cCount } = await svc.from("sale_commissions").select("id", { count: "exact", head: true }).eq("sale_id", C);
  wk = await weekOf(W);
  check("   CANCELADA: no se confirma, no genera comisión, no aparece como próxima a confirmar",
    r.ok === false && cCount === 0 && !row(wk.upcomingPrevious, C) && !row(wk.confirmedSales, C), { r, cCount });
  const cl = await rpc(seller.c, "seller_sales_list", { p_search: stamp, p_status: "CANCELLED", p_limit: 50 });
  check("   y sigue visible en el panel (historial)", (cl.items ?? []).some((i) => i.saleId === C));

  // ---------------------------------------------------------------- 12
  console.log("\n12 · Permisos");
  r = await rpc(seller2.c, "seller_weekly_liquidation", { p_seller_id: seller.id });
  check("12 · otro vendedor no puede pedir la semana ajena (NOT_ALLOWED)", r.ok === false && r.code === "NOT_ALLOWED", r);
  r = await rpc(seller2.c, "seller_sale_commission_previews", { p_sale_ids: [S, D, M] });
  check("   ni la comisión de ventas ajenas", r.ok === true && Object.keys(r.items ?? {}).length === 0);
  const { data: foreign } = await seller2.c.from("sales").select("id").in("id", [S, D, M]);
  check("   ni leer las ventas (RLS)", (foreign ?? []).length === 0);
  const own2 = await weekOf(W, seller2);
  check("   su propia semana no incluye ventas del otro vendedor", own2.ok === true && own2.confirmedSales.length === 0 && own2.summary.totalToPayCents === 0);
  r = await rpc(seller.c, "admin_liquidation_week_list", { p_week_start: W });
  check("   el vendedor no accede al listado del admin (NOT_ADMIN)", r.ok === false && r.code === "NOT_ADMIN", r);
  r = await rpc(admin.c, "seller_weekly_liquidation", { p_seller_id: seller.id, p_week_start: W });
  check("   el admin consulta la semana de cualquier vendedor con el mismo total", r.ok === true && r.summary.totalToPayCents === 210000);
}

async function cleanup() {
  console.log("\n· Limpiando datos de prueba");
  for (const id of created.sales) await svc.from("sales").delete().eq("id", id);
  for (const id of created.liquidations) await svc.from("weekly_liquidations").delete().eq("id", id);
  for (const e of await deleteTestProducts(svc, created.products)) console.log(`  ! ${e}`);

  console.log("\n11 · Datos reales intactos");
  const after = await realSnapshot(created.sellerIds);
  check(`ventas reales idénticas (${baseline.sales.length})`, same(after.sales, baseline.sales));
  check(`comisiones reales idénticas (${baseline.commissions.length})`, same(after.commissions, baseline.commissions));
  check(`liquidaciones reales idénticas (${baseline.liquidations.length})`, same(after.liquidations, baseline.liquidations));
  check(`ajustes de liquidación idénticos (${baseline.adjustments.length})`, same(after.adjustments, baseline.adjustments));
  const { data: left } = await svc.from("sales").select("id").in("id", created.sales.length ? created.sales : ["00000000-0000-0000-0000-000000000000"]);
  const { data: leftLiq } = await svc.from("weekly_liquidations").select("id").in("seller_id", created.sellerIds);
  check("no quedan ventas ni liquidaciones de prueba", (left ?? []).length === 0 && (leftLiq ?? []).length === 0, { left, leftLiq });
}

try {
  await main();
} catch (e) {
  fail++;
  console.log(`\n✘ ERROR: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  try {
    await cleanup();
  } catch (e) {
    fail++;
    console.log(`\n✘ ERROR en la limpieza: ${e instanceof Error ? e.message : String(e)}`);
  }
  console.log(`\nResultado: ${pass} ok · ${fail} fallos`);
  process.exit(fail ? 1 : 0);
}
