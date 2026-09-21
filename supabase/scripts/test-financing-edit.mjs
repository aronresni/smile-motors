/**
 * FINANCIAMIENTOS EDITABLES — prueba de integración contra la base REAL.
 *
 *   node --env-file=.env.local supabase/scripts/test-financing-edit.mjs \
 *     --admin e2e-smile-admin@motods.test --seller e2e-smile-seller@motods.test
 *
 * Qué fija (todo esto es dinero, así que se prueba antes que la interfaz):
 *   · administración y el vendedor pueden cambiar financiera, plan y monto,
 *   · los contratos de financiera SOBREVIVEN a una edición (el motor viejo los
 *     habría borrado en cascada),
 *   · el dinero que ya entró (ACREDITADO / LIQUIDADO) no se reescribe en
 *     silencio: hace falta deshacerlo a propósito, y queda registrado,
 *   · todo o nada: si algo está bloqueado, no se aplica ningún cambio,
 *   · nadie toca las ventas de otro.
 *
 * Crea y borra sus propios datos. No toca ventas, productos ni comisiones reales.
 */
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { commissionTier } from "./fixtures/commission-test-products.mjs";

const { values } = parseArgs({
  options: {
    admin: { type: "string" },
    seller: { type: "string" },
    seller2: { type: "string", default: "e2e-sm-seller@motods.test" },
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
const today = new Date().toISOString().slice(0, 10);
const created = { sales: [], products: [] };

const ZELLE = "2ab4abc7-f6a4-41a9-84b0-e0d2d0668fce";  // directo, sin fee
const AFFIRM = "6c02ce28-d964-487c-90ef-e784d857edd8"; // financiera, contrato obligatorio
const SYNCHRONY = "68800b33-efb0-4e62-9a68-b4b65ef5657c";

let ok = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) {
    ok++;
    console.log(`  ✔ ${name}`);
  } else {
    fail++;
    console.log(`  ✘ ${name}`);
    if (detail !== undefined) console.log("    →", JSON.stringify(detail));
  }
}

async function signIn(email) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password: values.password });
  if (error) throw new Error(`login ${email}: ${error.message}`);
  return { c, id: data.user.id };
}

async function rpc(client, fn, args = {}) {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}

const allocationsOf = async (saleId) =>
  (await svc.from("sale_payment_allocations").select("*").eq("sale_id", saleId).order("position")).data ?? [];
const contractsOf = async (saleId) =>
  (await svc.from("sale_financing_contracts").select("*").eq("sale_id", saleId)).data ?? [];
const historyOf = async (saleId, like) =>
  (await svc.from("sale_change_history").select("*").eq("sale_id", saleId).like("field_path", like)).data ?? [];

async function main() {
  const admin = await signIn(values.admin);
  const seller = await signIn(values.seller);
  const other = await signIn(values.seller2);

  console.log("\n· Preparando catálogo y ventas de prueba");
  const stamp = Date.now().toString(36).toUpperCase();
  const tier = commissionTier(1);
  const p = await rpc(admin.c, "admin_create_product", {
    p_name: `E2E FIN ${stamp}`, p_brand: "E2E", p_category: "Moto",
    p_base_price_cents: tier.fixedPriceCents, p_cuba_total_cents: tier.fixedPriceCents, p_is_active: true,
  });
  const productId = p.productId ?? p.id;
  created.products.push(productId);
  const variant = await rpc(admin.c, "admin_create_product_variant", { p_product_id: productId, p_color_name: "Negro E2E" });
  const variantId = variant.variantId ?? variant.id;
  await rpc(admin.c, "admin_update_product_commission_defaults", {
    p_product_id: productId,
    p_default_reference_price_cents: tier.fixedPriceCents,
    p_default_base_commission_cents: tier.fixedCommissionCents,
  });

  /** Venta PENDIENTE con las asignaciones que se pidan. */
  async function makeSale(allocations, { submit = true } = {}) {
    const { data: saleId, error } = await seller.c.rpc("create_sale_draft", { p_operation_type: "CUBA" });
    if (error) throw new Error(`create_sale_draft: ${error.message}`);
    created.sales.push(saleId);
    const total = allocations.reduce((s, a) => s + a.amountCents, 0);
    await rpc(seller.c, "save_cuba_sale_draft", {
      p_sale_id: saleId,
      p_payload: {
        saleDate: today, shareCommission: false, internalNotes: "Prueba de financiamientos",
        buyer: {
          firstName: "E2E", lastName: `Fin ${stamp}`, dateOfBirth: "1990-01-01", documentNumber: "E2E-FIN-1",
          documentExpiration: "2031-01-01", phone: "(305) 555-0177", email: "", addressLine1: "1 Test St",
          addressLine2: "", city: "Miami", state: "FL", postalCode: "33101",
        },
        coBuyer: null,
        units: [{ productId, variantId, agreedPriceCents: total }],
        extras: [],
        cubaRecipient: {
          fullName: "Destinatario E2E", identityNumber: "90010112345", deliveryAddress: "Calle 1 #2",
          municipality: "Plaza", province: "La Habana", phonePrimary: "+53 55555555", phoneSecondary: "",
        },
        delivery: { method: "HOME_DELIVERY", reference: "" },
        paymentAllocations: allocations.map((a) => ({
          id: null, paymentMethodId: a.method, planId: a.planId ?? null,
          inputMode: "NET", amountCents: a.amountCents, reference: "E2E", notes: "",
        })),
      },
    });
    for (const [subject, side] of [["BUYER", "FRONT"], ["BUYER", "BACK"], ["CUBA_RECIPIENT", "FRONT"], ["CUBA_RECIPIENT", "BACK"]]) {
      await seller.c.rpc("record_sale_document", {
        p_sale_id: saleId, p_subject_type: subject, p_side: side,
        p_storage_path: `${seller.id}/${saleId}/${subject}-${side}.jpg`,
        p_mime_type: "image/jpeg", p_file_size_bytes: 1000,
      });
    }
    if (submit) {
      const r = await rpc(seller.c, "request_sale_review", { p_sale_id: saleId });
      if (!r.ok) throw new Error(`request_sale_review: ${JSON.stringify(r)}`);
    }
    return saleId;
  }

  const price = tier.fixedPriceCents;

  // =====================================================================
  console.log("\nTEST 1 · Administración cambia financiera, plan y monto (sin contrato emitido)");
  const S1 = await makeSale([{ method: AFFIRM, amountCents: price }]);
  const [a1] = await allocationsOf(S1);
  const r1 = await rpc(admin.c, "set_sale_payment_allocations", {
    p_sale_id: S1,
    p_allocations: [{ id: a1.id, paymentMethodId: SYNCHRONY, planId: null, inputMode: "NET", amountCents: price, reference: "CORREGIDO", notes: "" }],
    p_reason: "Se eligió mal la financiera",
  });
  const [a1b] = await allocationsOf(S1);
  check("respuesta ok", r1.ok === true, r1);
  check("la financiera cambió", a1b.payment_method_id === SYNCHRONY && a1b.provider_name_snapshot !== a1.provider_name_snapshot, { antes: a1.provider_name_snapshot, después: a1b.provider_name_snapshot });
  check("MISMA fila (id conservado, no se borró y recreó)", a1b.id === a1.id);
  check("referencia aplicada", a1b.reference === "CORREGIDO");
  check("queda en el historial de la venta", (await historyOf(S1, "payments.%")).length >= 1);
  check("cuadre informado", r1.reconciliation?.balanced === true, r1.reconciliation);

  // =====================================================================
  console.log("\nTEST 2 · El VENDEDOR puede corregir los suyos");
  const r2 = await rpc(seller.c, "set_sale_payment_allocations", {
    p_sale_id: S1,
    p_allocations: [{ id: a1.id, paymentMethodId: ZELLE, planId: null, inputMode: "NET", amountCents: price, reference: "VENDEDOR", notes: "" }],
    p_reason: "El cliente prefirió pagar por Zelle",
  });
  const [a1c] = await allocationsOf(S1);
  check("respuesta ok", r2.ok === true, r2);
  check("aplicado por el vendedor", a1c.payment_method_id === ZELLE && a1c.reference === "VENDEDOR");

  // =====================================================================
  console.log("\nTEST 3 · Un contrato EMITIDO sobrevive a editar OTRA asignación (regresión)");
  const S3 = await makeSale([
    { method: AFFIRM, amountCents: price - 50000 },
    { method: ZELLE, amountCents: 50000 },
  ]);
  const allocs3 = await allocationsOf(S3);
  const fin3 = allocs3.find((a) => a.payment_method_id === AFFIRM);
  const zelle3 = allocs3.find((a) => a.payment_method_id === ZELLE);
  const sent3 = await rpc(admin.c, "mark_financing_sent", { p_sale_id: S3, p_payment_allocation_id: fin3.id });
  check("contrato enviado", sent3.ok === true, sent3);
  const contractsBefore = await contractsOf(S3);

  const r3 = await rpc(admin.c, "set_sale_payment_allocations", {
    p_sale_id: S3,
    p_allocations: [
      { id: fin3.id, paymentMethodId: AFFIRM, planId: null, inputMode: "NET", amountCents: fin3.net_amount_cents, reference: fin3.reference, notes: "" },
      { id: zelle3.id, paymentMethodId: ZELLE, planId: null, inputMode: "NET", amountCents: 50000, reference: "OTRA REF", notes: "" },
    ],
    p_reason: "Corregir la referencia del pago directo",
  });
  const contractsAfter = await contractsOf(S3);
  check("respuesta ok", r3.ok === true, r3);
  check("el contrato SIGUE existiendo, con su id y su estado", contractsAfter.length === contractsBefore.length && contractsAfter[0].id === contractsBefore[0].id && contractsAfter[0].status === "SENT", { antes: contractsBefore.length, después: contractsAfter.length });
  check("la asignación del contrato conserva su id", (await allocationsOf(S3)).some((a) => a.id === fin3.id));

  // =====================================================================
  console.log("\nTEST 4 · Con contrato EMITIDO: bloqueado, salvo que se anule a propósito");
  const bloqueado = await rpc(admin.c, "set_sale_payment_allocations", {
    p_sale_id: S3,
    p_allocations: [
      { id: fin3.id, paymentMethodId: SYNCHRONY, planId: null, inputMode: "NET", amountCents: fin3.net_amount_cents, reference: "", notes: "" },
      { id: zelle3.id, paymentMethodId: ZELLE, planId: null, inputMode: "NET", amountCents: 50000, reference: "OTRA REF", notes: "" },
    ],
    p_reason: "Cambiar la financiera con contrato enviado",
  });
  check("bloqueado CONTRACT_EMITTED", bloqueado.ok === false && bloqueado.code === "ALLOCATION_LOCKED" && bloqueado.blocked?.[0]?.code === "CONTRACT_EMITTED", bloqueado);
  check("TODO O NADA: la otra asignación tampoco cambió", (await allocationsOf(S3)).find((a) => a.id === fin3.id).payment_method_id === AFFIRM);

  const conAnulacion = await rpc(admin.c, "set_sale_payment_allocations", {
    p_sale_id: S3,
    p_allocations: [
      { id: fin3.id, paymentMethodId: SYNCHRONY, planId: null, inputMode: "NET", amountCents: fin3.net_amount_cents, reference: "", notes: "", voidContract: true },
      { id: zelle3.id, paymentMethodId: ZELLE, planId: null, inputMode: "NET", amountCents: 50000, reference: "OTRA REF", notes: "" },
    ],
    p_reason: "La financiera rechazó; se pasa a otra",
  });
  const contratos4 = await contractsOf(S3);
  check("aplicado con anulación explícita", conAnulacion.ok === true && conAnulacion.contractsVoided === 1, conAnulacion);
  check("el contrato queda ANULADO, no borrado (con motivo y autor)", contratos4[0].status === "VOID" && contratos4[0].void_reason?.length > 3 && contratos4[0].voided_by === admin.id, contratos4[0]);
  check("la financiera de la asignación cambió", (await allocationsOf(S3)).find((a) => a.id === fin3.id).payment_method_id === SYNCHRONY);
  const eventos4 = (await svc.from("financing_contract_events").select("*").eq("contract_id", contratos4[0].id)).data ?? [];
  check("el evento VOID quedó registrado", eventos4.some((e) => e.to_status === "VOID"), eventos4.map((e) => e.to_status));

  // =====================================================================
  console.log("\nTEST 5 · Dinero ACREDITADO: no se reescribe en silencio");
  const S5 = await makeSale([{ method: AFFIRM, amountCents: price }]);
  const [a5] = await allocationsOf(S5);
  await rpc(admin.c, "mark_financing_sent", { p_sale_id: S5, p_payment_allocation_id: a5.id });
  const [c5] = await contractsOf(S5);
  await rpc(admin.c, "mark_financing_signed", { p_contract_id: c5.id });
  const acred = await rpc(admin.c, "mark_financing_accredited", { p_contract_id: c5.id });
  check("contrato acreditado", acred.ok === true, acred);

  const r5 = await rpc(admin.c, "set_sale_payment_allocations", {
    p_sale_id: S5,
    p_allocations: [{ id: a5.id, paymentMethodId: ZELLE, planId: null, inputMode: "NET", amountCents: price, reference: "", notes: "", voidContract: true }],
    p_reason: "Intento de cambiar dinero ya acreditado",
  });
  check("bloqueado MONEY_ALREADY_IN (ni con voidContract)", r5.ok === false && r5.blocked?.[0]?.code === "MONEY_ALREADY_IN" && r5.blocked?.[0]?.lock === "ACCREDITED", r5);
  check("la asignación no se tocó", (await allocationsOf(S5))[0].payment_method_id === AFFIRM);
  check("el contrato sigue ACREDITADO", (await contractsOf(S5))[0].status === "ACCREDITED");

  const anulada = await rpc(admin.c, "admin_void_financing_contract", { p_contract_id: c5.id, p_reason: "La financiera revirtió la acreditación" });
  check("el admin puede deshacer la acreditación, con motivo", anulada.ok === true, anulada);
  check("el contrato queda ANULADO", (await contractsOf(S5))[0].status === "VOID");
  const r5b = await rpc(admin.c, "set_sale_payment_allocations", {
    p_sale_id: S5,
    p_allocations: [{ id: a5.id, paymentMethodId: ZELLE, planId: null, inputMode: "NET", amountCents: price, reference: "", notes: "" }],
    p_reason: "Se cobra por Zelle",
  });
  check("y recién entonces se puede cambiar", r5b.ok === true && (await allocationsOf(S5))[0].payment_method_id === ZELLE, r5b);

  // =====================================================================
  console.log("\nTEST 6 · Pago directo LIQUIDADO: igual de protegido");
  const S6 = await makeSale([{ method: ZELLE, amountCents: price }]);
  const [a6] = await allocationsOf(S6);
  const liq = await rpc(admin.c, "mark_payment_allocation_settled", { p_allocation_id: a6.id });
  check("pago liquidado", liq.ok === true, liq);
  const r6 = await rpc(admin.c, "set_sale_payment_allocations", {
    p_sale_id: S6,
    p_allocations: [{ id: a6.id, paymentMethodId: ZELLE, planId: null, inputMode: "NET", amountCents: price - 10000, reference: "", notes: "" }],
    p_reason: "Bajar el monto de un pago ya cobrado",
  });
  check("bloqueado MONEY_ALREADY_IN (SETTLED)", r6.ok === false && r6.blocked?.[0]?.lock === "SETTLED", r6);
  await rpc(admin.c, "admin_unsettle_payment_allocation", { p_allocation_id: a6.id, p_reason: "El cobro no había entrado" });
  const r6b = await rpc(admin.c, "set_sale_payment_allocations", {
    p_sale_id: S6,
    p_allocations: [{ id: a6.id, paymentMethodId: ZELLE, planId: null, inputMode: "NET", amountCents: price - 10000, reference: "", notes: "" }],
    p_reason: "Ajuste del monto",
  });
  check("tras deshacerlo, editable", r6b.ok === true && (await allocationsOf(S6))[0].net_amount_cents === price - 10000, r6b);
  check("el cuadre avisa de la diferencia", r6b.reconciliation?.balanced === false && r6b.reconciliation?.differenceCents === -10000, r6b.reconciliation);

  // =====================================================================
  console.log("\nTEST 7 · Altas y bajas");
  const S7 = await makeSale([{ method: ZELLE, amountCents: price }]);
  const [a7] = await allocationsOf(S7);
  const r7 = await rpc(admin.c, "set_sale_payment_allocations", {
    p_sale_id: S7,
    p_allocations: [
      { id: a7.id, paymentMethodId: ZELLE, planId: null, inputMode: "NET", amountCents: price - 100000, reference: "", notes: "" },
      { id: null, paymentMethodId: AFFIRM, planId: null, inputMode: "NET", amountCents: 100000, reference: "NUEVA", notes: "" },
    ],
    p_reason: "El cliente parte el pago en dos",
  });
  const allocs7 = await allocationsOf(S7);
  check("alta aplicada", r7.ok === true && r7.added === 1 && allocs7.length === 2, r7);
  check("sigue cuadrando con el total", r7.reconciliation?.balanced === true, r7.reconciliation);
  const r7b = await rpc(admin.c, "set_sale_payment_allocations", {
    p_sale_id: S7,
    p_allocations: [{ id: a7.id, paymentMethodId: ZELLE, planId: null, inputMode: "NET", amountCents: price, reference: "", notes: "" }],
    p_reason: "Vuelve a pagarse de una sola forma",
  });
  check("baja aplicada", r7b.ok === true && r7b.removed === 1 && (await allocationsOf(S7)).length === 1, r7b);
  check("la baja queda registrada", (await historyOf(S7, "payments.%")).some((h) => h.change_type === "REMOVE"));

  // =====================================================================
  console.log("\nTEST 8 · Seguridad");
  const ajena = await rpc(other.c, "set_sale_payment_allocations", {
    p_sale_id: S7,
    p_allocations: [{ id: a7.id, paymentMethodId: AFFIRM, planId: null, inputMode: "NET", amountCents: price, reference: "", notes: "" }],
    p_reason: "Intento sobre una venta ajena",
  });
  check("otro vendedor: NOT_OWNER", ajena.ok === false && ajena.code === "NOT_OWNER", ajena);
  check("y no cambió nada", (await allocationsOf(S7))[0].payment_method_id === ZELLE);

  const S8 = await makeSale([{ method: AFFIRM, amountCents: price }]);
  const [a8] = await allocationsOf(S8);
  await rpc(admin.c, "mark_financing_sent", { p_sale_id: S8, p_payment_allocation_id: a8.id });
  const [c8] = await contractsOf(S8);
  const anulaVendedor = await rpc(seller.c, "admin_void_financing_contract", { p_contract_id: c8.id, p_reason: "Intento del vendedor" });
  check("un vendedor no puede anular contratos", anulaVendedor.ok === false && anulaVendedor.code === "NOT_ADMIN", anulaVendedor);
  const sinVoid = await rpc(seller.c, "set_sale_payment_allocations", {
    p_sale_id: S8,
    p_allocations: [{ id: a8.id, paymentMethodId: ZELLE, planId: null, inputMode: "NET", amountCents: price, reference: "", notes: "", voidContract: true }],
    p_reason: "Vendedor intentando saltarse el contrato",
  });
  check("un vendedor no puede saltarse un contrato emitido", sinVoid.ok === false && sinVoid.blocked?.[0]?.code === "CONTRACT_EMITTED", sinVoid);
  check("el contrato sigue ENVIADO", (await contractsOf(S8))[0].status === "SENT");

  const sinMotivo = await rpc(admin.c, "set_sale_payment_allocations", {
    p_sale_id: S8, p_allocations: [], p_reason: "  ",
  });
  check("siempre exige un motivo", sinMotivo.ok === false && sinMotivo.code === "REASON_REQUIRED", sinMotivo);

  // =====================================================================
  console.log("\n· Limpiando");
  for (const id of created.sales) await svc.from("sales").delete().eq("id", id);
  for (const id of created.products) await svc.from("products").delete().eq("id", id);
  const quedan = (await svc.from("sales").select("id").in("id", created.sales)).data ?? [];
  check("no quedan ventas de prueba", quedan.length === 0);

  console.log(`\nResultado: ${ok} ok · ${fail} fallos`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error("\nERROR:", err.message);
  for (const id of created.sales) await svc.from("sales").delete().eq("id", id);
  for (const id of created.products) await svc.from("products").delete().eq("id", id);
  process.exit(1);
});
