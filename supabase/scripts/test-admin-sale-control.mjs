/**
 * Integración REAL (contra la base) del control administrativo de ventas:
 * edición/corrección directa, PENDING→SOLD por admin, cambios de producto,
 * comisión por snapshot, PAID y autorización.
 *
 * Uso:
 *   node --env-file=.env.local supabase/scripts/test-admin-sale-control.mjs \
 *     --admin e2e-smile-admin@motods.test --seller e2e-smile-seller@motods.test
 *
 * Crea sus propios datos (productos E2E y ventas) a través de las RPC
 * reales como vendedor/admin, y los elimina al terminar (service_role solo
 * para leer verificaciones y limpiar). No imprime datos personales reales.
 * Precio de referencia y comisión base: SOLO valores de prueba temporales de
 * `fixtures/commission-test-products.mjs` (N1 $3,500/$350 · N2 $3,799/$400 ·
 * N4 $4,299/$450), aplicados a sus propios productos de prueba.
 */
import { createClient } from "@supabase/supabase-js";
import { parseArgs } from "node:util";
import { commissionTier } from "./fixtures/commission-test-products.mjs";

const { values } = parseArgs({
  options: {
    admin: { type: "string" },
    seller: { type: "string" },
    password: { type: "string", default: process.env.E2E_PASSWORD },
    keep: { type: "boolean", default: false },
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

const ZELLE = "2ab4abc7-f6a4-41a9-84b0-e0d2d0668fce"; // método directo sin fee
const AFFIRM = "6c02ce28-d964-487c-90ef-e784d857edd8"; // financiera con contrato obligatorio

async function main() {
  const admin = await signIn(values.admin);
  const seller = await signIn(values.seller);

  // ------------------------------------------------------------ fixtures
  console.log("\n· Preparando catálogo de prueba (vía RPC admin)");
  async function makeProduct(name, { fixedPriceCents: refCents, fixedCommissionCents: baseCents }) {
    const r = await rpc(admin.c, "admin_create_product", {
      p_name: name, p_brand: "E2E", p_category: "Moto", p_base_price_cents: refCents,
      p_cuba_total_cents: refCents, p_is_active: true,
    });
    const productId = r.productId ?? r.id ?? r.product?.id;
    if (!productId) throw new Error(`admin_create_product: ${JSON.stringify(r)}`);
    created.products.push(productId);
    const v1 = await rpc(admin.c, "admin_create_product_variant", { p_product_id: productId, p_color_name: "Negro E2E" });
    const v2 = await rpc(admin.c, "admin_create_product_variant", { p_product_id: productId, p_color_name: "Rojo E2E" });
    const cfg = await rpc(admin.c, "admin_update_product_commission_defaults", {
      p_product_id: productId, p_default_reference_price_cents: refCents, p_default_base_commission_cents: baseCents,
    });
    if (!cfg.ok) throw new Error(`commission defaults: ${JSON.stringify(cfg)}`);
    return { id: productId, v1: v1.variantId ?? v1.id, v2: v2.variantId ?? v2.id };
  }
  const stamp = Date.now().toString(36).toUpperCase();
  const P1 = await makeProduct(`E2E SMILE ${stamp} A`, commissionTier(1)); // ref $3,500 · base $350
  const P2 = await makeProduct(`E2E SMILE ${stamp} B`, commissionTier(2)); // ref $3,799 · base $400

  async function makePendingSale({ method, amountCents, productId, variantId, submit = true }) {
    const { data: saleId, error } = await seller.c.rpc("create_sale_draft", { p_operation_type: "CUBA" });
    if (error) throw new Error(`create_sale_draft: ${error.message}`);
    created.sales.push(saleId);
    const payload = {
      saleDate: today, shareCommission: false, internalNotes: "Venta de prueba E2E",
      buyer: {
        firstName: "E2E", lastName: "Comprador", dateOfBirth: "1990-01-01", documentNumber: "E2E-DOC-1",
        documentExpiration: "2031-01-01", phone: "(305) 555-0101", email: "", addressLine1: "1 Test St",
        addressLine2: "", city: "Miami", state: "FL", postalCode: "33101",
      },
      coBuyer: null,
      units: [{ productId, variantId, agreedPriceCents: amountCents }],
      extras: [],
      cubaRecipient: {
        fullName: "Destinatario E2E", identityNumber: "90010112345", deliveryAddress: "Calle 1 #2",
        municipality: "Plaza", province: "La Habana", phonePrimary: "+53 55555555", phoneSecondary: "",
      },
      delivery: { method: "HOME_DELIVERY", reference: "" },
      paymentAllocations: [{ id: null, paymentMethodId: method, planId: null, inputMode: "NET", amountCents, reference: "E2E", notes: "" }],
    };
    const saved = await rpc(seller.c, "save_cuba_sale_draft", { p_sale_id: saleId, p_payload: payload });
    if (saved && saved.ok === false) throw new Error(`save draft: ${JSON.stringify(saved)}`);
    for (const [subject, side] of [["BUYER", "FRONT"], ["BUYER", "BACK"], ["CUBA_RECIPIENT", "FRONT"], ["CUBA_RECIPIENT", "BACK"]]) {
      const { error: de } = await seller.c.rpc("record_sale_document", {
        p_sale_id: saleId, p_subject_type: subject, p_side: side,
        p_storage_path: `${seller.id}/${saleId}/${subject.toLowerCase()}-${side.toLowerCase()}.jpg`,
        p_mime_type: "image/jpeg", p_file_size_bytes: 1000,
      });
      if (de) throw new Error(`record_sale_document: ${de.message}`);
    }
    if (submit) {
      const r = await rpc(seller.c, "request_sale_review", { p_sale_id: saleId });
      if (!r.ok) throw new Error(`request_sale_review: ${JSON.stringify(r)}`);
    }
    return saleId;
  }
  const saleRow = async (id) => (await svc.from("sales").select("*").eq("id", id).single()).data;
  const unitsOf = async (id) => (await svc.from("sale_units").select("*").eq("sale_id", id).order("position")).data ?? [];

  const A = await makePendingSale({ method: ZELLE, amountCents: 350000, productId: P1.id, variantId: P1.v1 });
  const B = await makePendingSale({ method: AFFIRM, amountCents: 350000, productId: P1.id, variantId: P1.v1 });
  const C = await makePendingSale({ method: ZELLE, amountCents: 350000, productId: P1.id, variantId: P1.v1 });
  const D = await makePendingSale({ method: ZELLE, amountCents: 350000, productId: P1.id, variantId: P1.v1, submit: false });
  const [uA] = await unitsOf(A);

  // ------------------------------------------------------------ TEST 1
  console.log("\nTEST 1 · Admin edita el teléfono del comprador (PENDING)");
  let r = await rpc(admin.c, "admin_update_cuba_sale", {
    p_sale_id: A, p_payload: { buyer: { phone: "(305) 555-0199" } }, p_reason: "El cliente actualizó su teléfono",
  });
  check("respuesta ok", r.ok === true, r);
  const { data: bA } = await svc.from("sale_parties").select("phone").eq("sale_id", A).eq("party_role", "PRIMARY_BUYER").single();
  check("teléfono aplicado", bA?.phone === "(305) 555-0199", bA);
  const { data: h1 } = await svc.from("sale_change_history").select("*").eq("sale_id", A).eq("field_path", "buyer.phone");
  check("auditoría: campo/antes/después", h1?.length === 1 && h1[0].old_value === "(305) 555-0101" && h1[0].new_value === "(305) 555-0199", h1);
  check("auditoría: actor admin + motivo + edit_kind ADMIN_EDIT", h1?.[0]?.changed_by === admin.id && h1?.[0]?.reason === "El cliente actualizó su teléfono" && h1?.[0]?.edit_kind === "ADMIN_EDIT", h1?.[0]);
  check("otros campos intactos (nombre)", (await svc.from("sale_parties").select("first_name").eq("sale_id", A).eq("party_role", "PRIMARY_BUYER").single()).data?.first_name === "E2E");
  check("sigue PENDING", (await saleRow(A)).status === "PENDING");

  // ------------------------------------------------------------ TEST 2
  console.log("\nTEST 2 · Admin cambia el precio acordado (PENDING) → total server-side");
  r = await rpc(admin.c, "admin_update_cuba_sale", {
    p_sale_id: A, p_reason: "Descuento acordado",
    p_payload: { units: [{ id: uA.id, productId: P1.id, variantId: P1.v1, agreedPriceCents: 370000 }] },
  });
  check("respuesta ok", r.ok === true, r);
  check("total recalculado en servidor = 370000", (await saleRow(A)).sale_total_cents === 370000 && r.saleTotalCents === 370000, r.saleTotalCents);
  check("señal de conciliación (pagos 350000 ≠ total)", r.reconciliation?.required === true && r.reconciliation?.differenceCents === -20000, r.reconciliation);
  r = await rpc(admin.c, "admin_update_cuba_sale", {
    p_sale_id: A, p_reason: "Se revierte el descuento",
    p_payload: { units: [{ id: uA.id, productId: P1.id, variantId: P1.v1, agreedPriceCents: 350000 }] },
  });
  check("revertido: total 350000 y sin conciliación", r.ok === true && r.saleTotalCents === 350000 && r.reconciliation?.required === false, r);

  // ------------------------------------------------------------ TEST 4 (antes de vender A)
  console.log("\nTEST 4 · Admin intenta PENDING→SOLD con contrato obligatorio sin firmar");
  r = await rpc(admin.c, "mark_sale_sold", { p_sale_id: B });
  check("bloqueado CONTRACT_UNSIGNED", r.ok === false && r.code === "CONTRACT_UNSIGNED", r);
  check("B sigue PENDING", (await saleRow(B)).status === "PENDING");

  // ------------------------------------------------------------ TEST 3
  console.log("\nTEST 3 · Admin marca VENDIDA una venta PENDING válida");
  r = await rpc(admin.c, "mark_sale_sold", { p_sale_id: A });
  check("respuesta ok", r.ok === true && r.status === "SOLD", r);
  const sA = await saleRow(A);
  check("status SOLD + número de venta + sold_by admin", sA.status === "SOLD" && /^VTA-/.test(sA.sale_number ?? "") && sA.sold_by === admin.id, { status: sA.status, n: sA.sale_number });
  const [uA2] = await unitsOf(A);
  check("tracking generado al vender", /^CU-/.test(uA2.tracking_code ?? ""), uA2.tracking_code);
  const { data: cA } = await svc.from("sale_commissions").select("*").eq("sale_unit_id", uA.id).single();
  check("comisión snapshot (ref 350000, base 35000 → final 35000)", cA?.reference_price_cents === 350000 && cA?.base_commission_cents === 35000 && cA?.final_commission_cents === 35000 && cA?.status === "PENDING", cA);
  const { data: lA } = await svc.from("sale_unit_logistics").select("status").eq("sale_unit_id", uA.id).single();
  check("logística inicializada PENDING_PREPARATION", lA?.status === "PENDING_PREPARATION", lA);
  const { data: hsA } = await svc.from("sale_status_history").select("*").eq("sale_id", A).eq("to_status", "SOLD").single();
  check("historial: actor admin + motivo administrativo", hsA?.changed_by === admin.id && /administraci/i.test(hsA?.reason ?? ""), hsA);

  // ------------------------------------------------------------ TEST 5
  console.log("\nTEST 5 · Admin corrige el precio de una venta VENDIDA");
  // La config viva del producto cambia DESPUÉS de vender: la comisión debe seguir usando el snapshot.
  const T4 = commissionTier(4); // pasa a $4,299 / $450 (otro nivel de prueba)
  await rpc(admin.c, "admin_update_product_commission_defaults", { p_product_id: P1.id, p_default_reference_price_cents: T4.fixedPriceCents, p_default_base_commission_cents: T4.fixedCommissionCents });
  r = await rpc(admin.c, "admin_update_cuba_sale", {
    p_sale_id: A, p_reason: "",
    p_payload: { units: [{ id: uA.id, productId: P1.id, variantId: P1.v1, agreedPriceCents: 360000 }] },
  });
  check("sin motivo → REASON_REQUIRED", r.ok === false && r.code === "REASON_REQUIRED", r);
  r = await rpc(admin.c, "admin_update_cuba_sale", {
    p_sale_id: A, p_reason: "Precio final corregido tras la entrega",
    p_payload: { units: [{ id: uA.id, productId: P1.id, variantId: P1.v1, agreedPriceCents: 360000 }] },
  });
  check("con motivo → ok", r.ok === true, r);
  check("total recalculado 360000", (await saleRow(A)).sale_total_cents === 360000);
  const { data: cA2 } = await svc.from("sale_commissions").select("*").eq("sale_unit_id", uA.id).single();
  check("comisión recalculada con SNAPSHOT (ref 350000/base 35000 → 35000+5000=40000)", cA2?.sale_price_cents === 360000 && cA2?.reference_price_cents === 350000 && cA2?.base_commission_cents === 35000 && cA2?.final_commission_cents === 40000, cA2);
  const { data: ceA } = await svc.from("commission_events").select("event_type").eq("commission_id", cA2.id).eq("event_type", "COMMISSION_ADJUSTED_BY_ADMIN_EDIT");
  check("evento de comisión COMMISSION_ADJUSTED_BY_ADMIN_EDIT", ceA?.length === 1, ceA);
  const { data: h5 } = await svc.from("sale_change_history").select("*").eq("sale_id", A).like("field_path", "units.%agreed_price_cents").order("changed_at", { ascending: false }).limit(1);
  check("auditoría del precio 350000 → 360000", h5?.[0]?.old_value === "350000" && h5?.[0]?.new_value === "360000", h5);
  check("señal de conciliación devuelta (pagos 350000 ≠ 360000)", r.reconciliation?.required === true, r.reconciliation);
  r = await rpc(admin.c, "admin_update_cuba_sale", {
    p_sale_id: A, p_reason: "Agregar unidad",
    p_payload: { units: [{ id: uA.id, productId: P1.id, variantId: P1.v1, agreedPriceCents: 360000 }, { id: null, productId: P2.id, variantId: P2.v1, agreedPriceCents: 1000 }] },
  });
  check("VENDIDA: agregar unidad bloqueado (UNIT_STRUCTURE_LOCKED)", r.ok === false && r.code === "UNIT_STRUCTURE_LOCKED", r);
  r = await rpc(admin.c, "admin_update_cuba_sale", {
    p_sale_id: A, p_reason: "Cambio de modelo",
    p_payload: { units: [{ id: uA.id, productId: P2.id, variantId: P2.v1, agreedPriceCents: 360000 }] },
  });
  check("VENDIDA: cambio de producto con comisión snapshoteada bloqueado", r.ok === false && r.code === "UNIT_PRODUCT_LOCKED_COMMISSION", r);
  r = await rpc(admin.c, "admin_update_cuba_sale", {
    p_sale_id: A, p_reason: "Precio bajo el mínimo",
    p_payload: { units: [{ id: uA.id, productId: P1.id, variantId: P1.v1, agreedPriceCents: 349999 }] },
  });
  check("VENDIDA: precio por debajo del precio fijo CONGELADO ($3,500) rechazado", r.ok === false && (r.errors ?? []).includes("UNIT_PRICE_BELOW_FIXED_PRICE"), r);
  // Se restaura el precio fijo original de P1 para el resto de la prueba.
  await rpc(admin.c, "admin_update_product_commission_defaults", { p_product_id: P1.id, p_default_reference_price_cents: commissionTier(1).fixedPriceCents, p_default_base_commission_cents: commissionTier(1).fixedCommissionCents });

  // ------------------------------------------------------------ TEST 7
  console.log("\nTEST 7 · Marcar PAGADA con saldo pendiente");
  r = await rpc(admin.c, "admin_mark_sale_paid", { p_sale_id: A });
  check("bloqueado SETTLEMENT_INCOMPLETE", r.ok === false && r.code === "SETTLEMENT_INCOMPLETE", r);
  check("A sigue SOLD", (await saleRow(A)).status === "SOLD");

  // ------------------------------------------------------------ TEST 6
  // Sin gestión de VIN (migración 20260918120000): cambiar producto/variante
  // de una venta PENDIENTE ya no exige resolver inventario; producto y
  // variante siguen validados contra el catálogo.
  console.log("\nTEST 6 · Cambio de producto/variante sin VIN (PENDING)");
  const [uC] = await unitsOf(C);
  r = await rpc(admin.c, "admin_update_cuba_sale", {
    p_sale_id: C, p_reason: "Cambio de modelo",
    p_payload: { units: [{ id: uC.id, productId: P2.id, variantId: P2.v1, agreedPriceCents: 350000 }] },
  });
  check("cambio a un producto con precio fijo mayor ($3,799) sin subir el precio → rechazado", r.ok === false && (r.errors ?? []).includes("UNIT_PRICE_BELOW_FIXED_PRICE"), r);
  r = await rpc(admin.c, "admin_update_cuba_sale", {
    p_sale_id: C, p_reason: "Cambio de modelo",
    p_payload: { units: [{ id: uC.id, productId: P2.id, variantId: P2.v1, agreedPriceCents: 380000 }] },
  });
  check("cambio de producto permitido (sin VIN, precio >= precio fijo del nuevo producto)", r.ok === true, r);
  const [uC2] = await unitsOf(C);
  check("snapshot regenerado desde el catálogo y seguimiento intacto", uC2.product_id === P2.id && uC2.product_variant_id === P2.v1 && uC2.tracking_code === uC.tracking_code, uC2);
  r = await rpc(admin.c, "admin_update_cuba_sale", {
    p_sale_id: C, p_reason: "Variante ajena",
    p_payload: { units: [{ id: uC.id, productId: P1.id, variantId: P2.v2, agreedPriceCents: 350000 }] },
  });
  check("variante que no pertenece al producto → rechazada", r.ok === false && (r.errors ?? []).includes("UNIT_VARIANT_MISMATCH"), r);
  r = await rpc(admin.c, "admin_update_cuba_sale", {
    p_sale_id: C, p_reason: "Vuelve al modelo original",
    p_payload: { units: [{ id: uC.id, productId: P1.id, variantId: P1.v1, agreedPriceCents: 350000 }] },
  });
  check("vuelve al producto original para continuar", r.ok === true, r);

  // ------------------------------------------------------------ TEST 8
  console.log("\nTEST 8 · Venta VENDIDA totalmente cobrada → PAGADA");
  r = await rpc(admin.c, "mark_sale_sold", { p_sale_id: C });
  check("C marcada VENDIDA por admin", r.ok === true, r);
  const { data: allocC } = await svc.from("sale_payment_allocations").select("id").eq("sale_id", C);
  r = await rpc(admin.c, "mark_payment_allocation_settled", { p_allocation_id: allocC[0].id });
  check("pago directo liquidado", r.ok === true, r);
  check("NO se marca pagada automáticamente", (await saleRow(C)).status === "SOLD");
  r = await rpc(admin.c, "admin_mark_sale_paid", { p_sale_id: C });
  check("respuesta ok", r.ok === true, r);
  const sC = await saleRow(C);
  check("PAID + paid_at + paid_by admin", sC.status === "PAID" && Boolean(sC.paid_at) && sC.paid_by === admin.id, { status: sC.status });
  const { data: cC } = await svc.from("sale_commissions").select("status, eligible_at").eq("sale_id", C);
  check("comisión pasa a ELEGIBLE (comportamiento intacto)", cC?.[0]?.status === "ELIGIBLE" && Boolean(cC?.[0]?.eligible_at), cC);

  // ------------------------------------------------------------ TEST 10
  console.log("\nTEST 10 · Venta PAGADA: sin corrección administrativa no se edita");
  r = await rpc(admin.c, "admin_update_cuba_sale", { p_sale_id: C, p_reason: "Cambio", p_payload: { buyer: { phone: "(305) 555-0177" } } });
  check("sin flujo de corrección → PAID_REQUIRES_ADMIN_CORRECTION", r.ok === false && r.code === "PAID_REQUIRES_ADMIN_CORRECTION", r);
  r = await rpc(admin.c, "admin_update_cuba_sale", { p_sale_id: C, p_reason: "", p_admin_correction: true, p_payload: { buyer: { phone: "(305) 555-0177" } } });
  check("corrección sin motivo → REASON_REQUIRED", r.ok === false && r.code === "REASON_REQUIRED", r);
  const [uCp] = await unitsOf(C);
  r = await rpc(admin.c, "admin_update_cuba_sale", {
    p_sale_id: C, p_reason: "Ajuste de precio", p_admin_correction: true,
    p_payload: { units: [{ id: uCp.id, productId: P1.id, variantId: P1.v1, agreedPriceCents: 349000 }] },
  });
  check("corrección con cambio de importe → PAID_FINANCIAL_CHANGE_BLOCKED", r.ok === false && r.code === "PAID_FINANCIAL_CHANGE_BLOCKED", r);
  const paidAtBefore = (await saleRow(C)).paid_at;
  r = await rpc(admin.c, "admin_update_cuba_sale", {
    p_sale_id: C, p_reason: "Corrección del teléfono tras el pago", p_admin_correction: true,
    p_payload: { buyer: { phone: "(305) 555-0177" } },
  });
  check("corrección no financiera con motivo → ok", r.ok === true && r.editKind === "ADMIN_CORRECTION", r);
  const sC2 = await saleRow(C);
  check("sigue PAID, paid_at y total intactos", sC2.status === "PAID" && sC2.paid_at === paidAtBefore && sC2.sale_total_cents === 350000);
  const { data: h10 } = await svc.from("sale_change_history").select("edit_kind, old_value, new_value").eq("sale_id", C).eq("field_path", "buyer.phone");
  check("auditoría con edit_kind ADMIN_CORRECTION y valores antes/después", h10?.length === 1 && h10[0].edit_kind === "ADMIN_CORRECTION" && h10[0].old_value === "(305) 555-0101", h10);

  // ------------------------------------------------------------ TEST 9
  console.log("\nTEST 9 · El vendedor intenta el endpoint de corrección administrativa");
  r = await rpc(seller.c, "admin_update_cuba_sale", { p_sale_id: A, p_reason: "Intento", p_payload: { buyer: { phone: "000" } } });
  check("NOT_ADMIN", r.ok === false && r.code === "NOT_ADMIN", r);
  r = await rpc(seller.c, "admin_global_search", { p_query: "E2E" });
  check("búsqueda global también NOT_ADMIN", r.ok === false && r.code === "NOT_ADMIN", r);
  r = await rpc(seller.c, "update_confirmed_cuba_sale", { p_sale_id: A, p_payload: {}, p_reason: "bypass" });
  check("el motor interno sigue cerrado al cliente", r.ok !== true, r);

  // ------------------------------------------------------------ extras
  console.log("\nEXTRA · DRAFT→PENDING por admin, concurrencia, búsqueda y actividad");
  r = await rpc(admin.c, "admin_update_cuba_sale", { p_sale_id: D, p_reason: "", p_payload: { internalNotes: "Nota del admin en borrador" } });
  check("admin edita BORRADOR sin motivo (default)", r.ok === true, r);
  r = await rpc(admin.c, "request_sale_review", { p_sale_id: D });
  check("admin envía BORRADOR a revisión", r.ok === true && (await saleRow(D)).status === "PENDING", r);
  const { data: hsD } = await svc.from("sale_status_history").select("reason, changed_by").eq("sale_id", D).eq("to_status", "PENDING").single();
  check("historial DRAFT→PENDING registra al admin", hsD?.changed_by === admin.id && /administraci/i.test(hsD?.reason ?? ""), hsD);
  r = await rpc(admin.c, "admin_update_cuba_sale", {
    p_sale_id: B, p_reason: "Edición concurrente", p_payload: { internalNotes: "x" }, p_expected_updated_at: "2020-01-01T00:00:00Z",
  });
  check("versión vieja → SALE_CHANGED", r.ok === false && r.code === "SALE_CHANGED", r);
  const sB = await saleRow(B);
  r = await rpc(admin.c, "admin_update_cuba_sale", {
    p_sale_id: B, p_reason: "Edición con versión vigente", p_payload: { internalNotes: "Revisado por admin" }, p_expected_updated_at: sB.updated_at,
  });
  check("versión vigente → ok", r.ok === true, r);
  r = await rpc(admin.c, "admin_global_search", { p_query: sA.sale_number });
  check("búsqueda global encuentra la venta por número", r.ok === true && r.sales?.some((x) => x.id === A), r.sales?.length);
  r = await rpc(admin.c, "admin_global_search", { p_query: uA2.tracking_code });
  check("búsqueda global encuentra por código de seguimiento", r.ok === true && r.sales?.some((x) => x.id === A));
  r = await rpc(admin.c, "admin_activity_feed", { p_search: sA.sale_number, p_limit: 50 });
  check("Actividad muestra la edición administrativa", r.ok === true && r.items?.some((i) => i.eventType === "ADMIN_EDIT"), r.items?.map((i) => i.eventType));
  r = await rpc(admin.c, "admin_activity_feed", { p_search: sC.sale_number, p_limit: 50 });
  check("Actividad muestra la corrección administrativa", r.ok === true && r.items?.some((i) => i.eventType === "ADMIN_CORRECTION"), r.items?.map((i) => i.eventType));

  // ------------------------------------------------------------ regresión
  console.log("\nREGRESIÓN · flujos existentes del vendedor intactos");
  const E = await makePendingSale({ method: ZELLE, amountCents: 350000, productId: P1.id, variantId: P1.v1 });
  r = await rpc(seller.c, "mark_sale_sold", { p_sale_id: E });
  const sE = await saleRow(E);
  check("el vendedor marca SU venta como vendida (sin motivo administrativo)", r.ok === true && sE.status === "SOLD" && sE.sold_by === seller.id, r);
  const { data: hsE } = await svc.from("sale_status_history").select("reason").eq("sale_id", E).eq("to_status", "SOLD").single();
  check("historial del vendedor sin motivo administrativo", hsE?.reason == null, hsE);
  const { data: pB } = await svc.from("sale_parties").select("phone").eq("sale_id", B).eq("party_role", "PRIMARY_BUYER").single();
  r = await rpc(seller.c, "request_sale_edit", {
    p_sale_id: B, p_reason: "Cambio de teléfono del cliente",
    p_changes: [{ path: "buyer.phone", oldValue: pB.phone, newValue: "(305) 555-0123" }],
  });
  check("solicitud de edición del vendedor creada", r.ok === true && Boolean(r.requestId), r);
  r = await rpc(admin.c, "approve_sale_edit_request", { p_request_id: r.requestId });
  check("aprobación del admin aplicada", r.ok === true, r);
  const { data: hB } = await svc.from("sale_change_history").select("edit_kind, request_id").eq("sale_id", B).eq("field_path", "buyer.phone");
  check("auditoría de la solicitud aprobada: edit_kind APPROVED_REQUEST + request_id", hB?.length === 1 && hB[0].edit_kind === "APPROVED_REQUEST" && Boolean(hB[0].request_id), hB);
}

async function cleanup() {
  if (values.keep) {
    console.log("\n(--keep) datos de prueba conservados:", created);
    return;
  }
  console.log("\n· Limpiando datos de prueba");
  for (const id of created.sales) {
    const { error } = await svc.from("sales").delete().eq("id", id);
    if (error) console.log(`  ! venta ${id}: ${error.message}`);
  }
  for (const id of created.products) {
    await svc.from("product_catalog_events").delete().eq("product_id", id);
    await svc.from("product_variants").delete().eq("product_id", id);
    const { error } = await svc.from("products").delete().eq("id", id);
    if (error) {
      console.log(`  ! producto ${id}: ${error.message} — se desactiva`);
      await svc.from("products").update({ is_active: false }).eq("id", id);
    }
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
