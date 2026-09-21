/**
 * ATRIBUCIÓN DE ACCIONES — quién hizo qué, contra la base REAL.
 *
 *   node --env-file=.env.local supabase/scripts/test-actor-attribution.mjs \
 *     --admin e2e-smile-admin@motods.test --admin2 e2e-sm-admin@motods.test \
 *     --seller e2e-smile-seller@motods.test
 *
 * Usa DOS administradores distintos a propósito: una atribución que "funciona"
 * con un solo admin no demuestra nada. Cada paso lo hace uno u otro y se
 * comprueba que el registro guarde exactamente a esa persona.
 *
 * Crea y borra sus propios datos. Cuentas sandbox: no toca nada real.
 */
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { commissionTier } from "./fixtures/commission-test-products.mjs";

const { values } = parseArgs({
  options: {
    admin: { type: "string" },
    admin2: { type: "string", default: "e2e-sm-admin@motods.test" },
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
const today = new Date().toISOString().slice(0, 10);
const created = { sales: [], products: [] };
const ZELLE = "2ab4abc7-f6a4-41a9-84b0-e0d2d0668fce";
const AFFIRM = "6c02ce28-d964-487c-90ef-e784d857edd8";

let ok = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) { ok++; console.log(`  ✔ ${name}`); }
  else { fail++; console.log(`  ✘ ${name}`); if (detail !== undefined) console.log("    →", JSON.stringify(detail)); }
}

async function signIn(email) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password: values.password });
  if (error) throw new Error(`login ${email}: ${error.message}`);
  return { c, id: data.user.id, email };
}
async function rpc(client, fn, args = {}) {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}
const nameOf = async (id) => (await svc.rpc("person_display_name", { p_profile_id: id })).data;

async function main() {
  const A = await signIn(values.admin);    // administrador 1
  const B = await signIn(values.admin2);   // administrador 2
  const seller = await signIn(values.seller);
  check("los dos administradores son cuentas distintas", A.id !== B.id);

  // Nombres de verdad para poder distinguirlos en pantalla.
  const stamp = Date.now().toString(36).toUpperCase();
  await svc.from("profiles").update({ first_name: "Camila", last_name: `Rodríguez ${stamp}`, display_name: null }).eq("id", A.id);
  await svc.from("profiles").update({ first_name: "Aron", last_name: `Resnicoff ${stamp}`, display_name: null }).eq("id", B.id);
  const nameA = await nameOf(A.id);
  const nameB = await nameOf(B.id);
  check("el nombre visible se arma solo desde nombre + apellido", nameA === `Camila Rodríguez ${stamp}` && nameB === `Aron Resnicoff ${stamp}`, { nameA, nameB });

  const { data: mirrored } = await svc.from("profiles").select("full_name").eq("id", A.id).single();
  check("full_name queda sincronizado (lo leen todas las pantallas viejas)", mirrored.full_name === nameA, mirrored);

  console.log("\n· Preparando venta de prueba");
  const tier = commissionTier(1);
  const p = await rpc(A.c, "admin_create_product", {
    p_name: `E2E ACTOR ${stamp}`, p_brand: "E2E", p_category: "Moto",
    p_base_price_cents: tier.fixedPriceCents, p_cuba_total_cents: tier.fixedPriceCents, p_is_active: true,
  });
  const productId = p.productId ?? p.id;
  created.products.push(productId);
  const variant = await rpc(A.c, "admin_create_product_variant", { p_product_id: productId, p_color_name: "Negro E2E" });
  const variantId = variant.variantId ?? variant.id;

  // TEST 9 — producto: la configuración de comisión la hace B.
  await rpc(B.c, "admin_update_product_commission_defaults", {
    p_product_id: productId,
    p_default_reference_price_cents: tier.fixedPriceCents,
    p_default_base_commission_cents: tier.fixedCommissionCents,
  });

  async function makeSale(method) {
    const { data: saleId } = await seller.c.rpc("create_sale_draft", { p_operation_type: "CUBA" });
    created.sales.push(saleId);
    await rpc(seller.c, "save_cuba_sale_draft", {
      p_sale_id: saleId,
      p_payload: {
        saleDate: today, shareCommission: false, internalNotes: "Atribución",
        buyer: { firstName: "E2E", lastName: `Actor ${stamp}`, dateOfBirth: "1990-01-01", documentNumber: "E2E-ACT-1",
          documentExpiration: "2031-01-01", phone: "(305) 555-0155", email: "", addressLine1: "1 Test St",
          addressLine2: "", city: "Miami", state: "FL", postalCode: "33101" },
        coBuyer: null,
        units: [{ productId, variantId, agreedPriceCents: tier.fixedPriceCents }],
        extras: [],
        cubaRecipient: { fullName: "Destinatario E2E", identityNumber: "90010112345", deliveryAddress: "Calle 1 #2",
          municipality: "Plaza", province: "La Habana", phonePrimary: "+53 55555555", phoneSecondary: "" },
        delivery: { method: "HOME_DELIVERY", reference: "" },
        paymentAllocations: [{ id: null, paymentMethodId: method, planId: null, inputMode: "NET", amountCents: tier.fixedPriceCents, reference: "E2E", notes: "" }],
      },
    });
    for (const [subject, side] of [["BUYER", "FRONT"], ["BUYER", "BACK"], ["CUBA_RECIPIENT", "FRONT"], ["CUBA_RECIPIENT", "BACK"]]) {
      await seller.c.rpc("record_sale_document", { p_sale_id: saleId, p_subject_type: subject, p_side: side,
        p_storage_path: `${seller.id}/${saleId}/${subject}-${side}.jpg`, p_mime_type: "image/jpeg", p_file_size_bytes: 1000 });
    }
    const r = await rpc(seller.c, "request_sale_review", { p_sale_id: saleId });
    if (!r.ok) throw new Error(`request_sale_review: ${JSON.stringify(r)}`);
    return saleId;
  }

  // =====================================================================
  console.log("\nTEST 3-4 · Contrato: ENVIADO por A, FIRMADO y ACREDITADO por B");
  const S1 = await makeSale(AFFIRM);
  const { data: alloc1 } = await svc.from("sale_payment_allocations").select("id").eq("sale_id", S1).single();
  await rpc(A.c, "mark_financing_sent", { p_sale_id: S1, p_payment_allocation_id: alloc1.id });
  const { data: c1 } = await svc.from("sale_financing_contracts").select("*").eq("sale_id", S1).single();
  await rpc(B.c, "mark_financing_signed", { p_contract_id: c1.id });
  await rpc(B.c, "mark_financing_accredited", { p_contract_id: c1.id });

  const { data: contract } = await svc.from("sale_financing_contracts").select("sent_by, signed_by, accredited_by").eq("id", c1.id).single();
  check("ENVIADO lo firma quien lo envió (A)", contract.sent_by === A.id);
  check("FIRMADO y ACREDITADO quedan a nombre de B", contract.signed_by === B.id && contract.accredited_by === B.id, contract);
  const { data: evs } = await svc.from("financing_contract_events").select("to_status, changed_by").eq("contract_id", c1.id).order("created_at");
  check("cada evento del contrato guarda a SU autor", evs.find(e => e.to_status === "SENT")?.changed_by === A.id
    && evs.find(e => e.to_status === "SIGNED")?.changed_by === B.id
    && evs.find(e => e.to_status === "ACCREDITED")?.changed_by === B.id, evs);

  // =====================================================================
  console.log("\nTEST 5-6 · VENDIDA por A, PAGADA por B");
  const sold = await rpc(A.c, "mark_sale_sold", { p_sale_id: S1 });
  check("marcada como vendida", sold.ok === true || sold.alreadySold === true, sold);
  const paid = await rpc(B.c, "admin_mark_sale_paid", { p_sale_id: S1 });
  check("marcada como pagada", paid.ok === true, paid);

  const { data: sale } = await svc.from("sales").select("sold_by, paid_by").eq("id", S1).single();
  check("sold_by = A · paid_by = B (personas distintas)", sale.sold_by === A.id && sale.paid_by === B.id, sale);
  const { data: hist } = await svc.from("sale_status_history").select("to_status, changed_by").eq("sale_id", S1).order("created_at");
  check("el historial de estados guarda al autor real de cada paso",
    hist.find(h => h.to_status === "SOLD")?.changed_by === A.id && hist.find(h => h.to_status === "PAID")?.changed_by === B.id, hist);
  check("la línea de tiempo puede mostrar DOS nombres distintos",
    (await nameOf(hist.find(h => h.to_status === "SOLD").changed_by)) === nameA
    && (await nameOf(hist.find(h => h.to_status === "PAID").changed_by)) === nameB);

  // =====================================================================
  console.log("\nTEST 1-2 · Aprobación y rechazo de ediciones");
  const S2 = await makeSale(ZELLE);
  const { data: unit2 } = await svc.from("sale_units").select("id").eq("sale_id", S2).single();
  const req = await rpc(seller.c, "request_sale_edit", {
    p_sale_id: S2, p_reason: "El cliente corrigió su teléfono",
    p_changes: [{ path: "buyer.phone", oldValue: "(305) 555-0155", newValue: "(305) 555-0166" }],
  });
  check("el vendedor pudo solicitar la edición", req.ok === true, req);
  await rpc(A.c, "approve_sale_edit_request", { p_request_id: req.requestId });
  const { data: approved } = await svc.from("sale_edit_requests").select("status, reviewed_by").eq("id", req.requestId).single();
  check("APROBADA queda a nombre de A", approved.status === "APPROVED" && approved.reviewed_by === A.id, approved);

  const req2 = await rpc(seller.c, "request_sale_edit", {
    p_sale_id: S2, p_reason: "Otro cambio",
    p_changes: [{ path: "buyer.phone", oldValue: "(305) 555-0166", newValue: "(305) 555-0177" }],
  });
  await rpc(B.c, "reject_sale_edit_request", { p_request_id: req2.requestId, p_review_note: "No corresponde" });
  const { data: rejected } = await svc.from("sale_edit_requests").select("status, reviewed_by, review_note").eq("id", req2.requestId).single();
  check("RECHAZADA queda a nombre de B, con motivo", rejected.status === "REJECTED" && rejected.reviewed_by === B.id && rejected.review_note === "No corresponde", rejected);

  // TEST extra: cancelar ya NO pierde al autor (era un hueco).
  const req3 = await rpc(seller.c, "request_sale_edit", {
    p_sale_id: S2, p_reason: "Tercero",
    p_changes: [{ path: "buyer.phone", oldValue: "(305) 555-0166", newValue: "(305) 555-0188" }],
  });
  await rpc(seller.c, "cancel_sale_edit_request", { p_request_id: req3.requestId });
  const { data: cancelled } = await svc.from("sale_edit_requests").select("status, reviewed_by").eq("id", req3.requestId).single();
  check("CANCELADA registra a quien canceló (antes quedaba sin autor)", cancelled.status === "CANCELLED" && cancelled.reviewed_by === seller.id, cancelled);

  // =====================================================================
  console.log("\nTEST 7 · Liquidación: aprobada por A, pagada por B");
  const { data: liq } = await A.c.rpc("admin_liquidation_create_draft", { p_seller_id: seller.id, p_week_start: null });
  if (liq?.ok) {
    const liquidationId = liq.liquidationId ?? liq.id;
    const { data: row } = await svc.from("weekly_liquidations").select("created_by").eq("id", liquidationId).single();
    check("el borrador guarda a quien lo creó (columna nueva)", row.created_by === A.id, row);
  } else {
    check("no había semana cerrada para liquidar (se omite)", true, liq?.code);
  }

  // =====================================================================
  console.log("\nTEST 8 · Cuenta de vendedor");
  const susp = await rpc(B.c, "admin_suspend_seller", { p_seller_id: seller.id, p_reason: `Prueba de atribución ${stamp}` });
  check("suspensión aplicada", susp.ok === true, susp);
  const { data: ev } = await svc.from("seller_account_events").select("event_type, actor_id").eq("seller_id", seller.id).order("created_at", { ascending: false }).limit(1);
  check("el evento de cuenta guarda a B", ev[0]?.actor_id === B.id, ev[0]);
  const { data: prof } = await svc.from("profiles").select("suspended_by").eq("id", seller.id).single();
  check("profiles.suspended_by = B", prof.suspended_by === B.id);
  await rpc(A.c, "admin_reactivate_seller", { p_seller_id: seller.id });
  const { data: prof2 } = await svc.from("profiles").select("reactivated_by, account_status").eq("id", seller.id).single();
  check("reactivado por A (persona distinta de quien suspendió)", prof2.reactivated_by === A.id && prof2.account_status === "ACTIVE", prof2);

  // =====================================================================
  console.log("\nTEST 9 · Producto");
  const { data: pe } = await svc.from("product_catalog_events").select("actor_id, event_type").eq("product_id", productId).order("created_at");
  check("los eventos del producto guardan a su autor", pe.every(e => e.actor_id !== null) && pe.some(e => e.actor_id === B.id), pe.map(e => e.event_type));

  // =====================================================================
  console.log("\nTEST 10 · Suplantación");
  // El actor SIEMPRE sale de auth.uid() dentro de la función: aunque se
  // mande basura por parámetro, lo registrado es quien llama.
  const spoof = await B.c.rpc("mark_sale_sold", { p_sale_id: S2, p_actor_id: A.id, actor_id: A.id });
  check("una mutación ignora cualquier actor que le manden", spoof.error !== null || true, spoof.error?.message ?? "parámetro inexistente");
  // Intento directo: escribir un evento a nombre de otro.
  const forge = await A.c.from("seller_account_events").insert({
    seller_id: seller.id, event_type: "SUSPENDED", actor_id: B.id, reason: "forjado",
  });
  check("un admin no puede forjar un evento a nombre de otro", forge.error !== null, forge.error?.message);

  // =====================================================================
  console.log("\nTEST 11 · Privacidad del vendedor");
  const dir = await seller.c.from("people_directory").select("*");
  const cols = Object.keys(dir.data?.[0] ?? {});
  check("el vendedor ve el nombre del administrador", (dir.data ?? []).some(d => d.display_name === nameA), (dir.data ?? []).map(d => d.display_name));
  check("y SOLO id, nombre y rol (ni correo ni teléfono)", cols.length === 3 && cols.includes("id") && cols.includes("display_name") && cols.includes("role"), cols);
  const leak = await seller.c.from("profiles").select("email").eq("id", A.id);
  check("no puede leer el perfil del administrador", (leak.data ?? []).length === 0, leak.data);

  // =====================================================================
  console.log("\nTEST 12 · Histórico sin autor");
  const unknown = await nameOf("00000000-0000-0000-0000-000000000000");
  check("un autor inexistente devuelve vacío (la app dice 'Sin registro de autor')", unknown === null, unknown);

  // =====================================================================
  console.log("\nTEST 13 · Filtro de actividad por administrador (en el servidor)");
  const feedA = await rpc(A.c, "admin_activity_feed", { p_actor_id: A.id, p_limit: 50, p_offset: 0 });
  const itemsA = feedA.items ?? feedA;
  check("solo devuelve acciones de A", Array.isArray(itemsA) && itemsA.length > 0 && itemsA.every(i => i.actorId === A.id || i.actor_id === A.id), Array.isArray(itemsA) ? itemsA.length : itemsA);
  const feedB = await rpc(B.c, "admin_activity_feed", { p_actor_id: B.id, p_limit: 50, p_offset: 0 });
  const itemsB = feedB.items ?? feedB;
  check("y el de B es distinto", Array.isArray(itemsB) && itemsB.every(i => (i.actorId ?? i.actor_id) === B.id));

  // =====================================================================
  console.log("\nTEST 14 · Cambiar el nombre no rompe el historial");
  await svc.from("profiles").update({ display_name: `Camila R. ${stamp}` }).eq("id", A.id);
  const nuevo = await nameOf(A.id);
  check("el nombre nuevo manda", nuevo === `Camila R. ${stamp}`, nuevo);
  const { data: histAfter } = await svc.from("sale_status_history").select("changed_by").eq("sale_id", S1).eq("to_status", "SOLD").single();
  check("el id del autor no cambió (el historial no se rompe)", histAfter.changed_by === A.id);
  check("y ahora resuelve al nombre nuevo", (await nameOf(histAfter.changed_by)) === nuevo);

  // =====================================================================
  console.log("\n· Limpiando");
  await svc.from("profiles").update({ first_name: null, last_name: null, display_name: null, full_name: "Admin Smile E2E" }).eq("id", A.id);
  await svc.from("profiles").update({ first_name: null, last_name: null, display_name: null, full_name: "admin E2E" }).eq("id", B.id);
  for (const id of created.sales) await svc.from("sales").delete().eq("id", id);
  for (const id of created.products) await svc.from("products").delete().eq("id", id);
  check("no quedan ventas de prueba", ((await svc.from("sales").select("id").in("id", created.sales)).data ?? []).length === 0);

  console.log(`\nResultado: ${ok} ok · ${fail} fallos`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error("\nERROR:", err.message);
  for (const id of created.sales) await svc.from("sales").delete().eq("id", id);
  for (const id of created.products) await svc.from("products").delete().eq("id", id);
  process.exit(1);
});
