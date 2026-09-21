/**
 * Integración REAL (contra la base) del sistema de NOTIFICACIONES
 * (migración 20260923120000): destinatarios, textos, enlaces, deduplicación,
 * lectura, seguridad (RLS + Realtime) y que un fallo de negocio no notifique.
 *
 *   node --env-file=.env.local supabase/scripts/test-notifications.mjs \
 *     --admin e2e-smile-admin@motods.test --seller e2e-smile-seller@motods.test
 *   (contraseña: E2E_PASSWORD de .env.local)
 *
 * Crea y elimina sus propios datos (producto de prueba, ventas, contratos,
 * liquidación, una cuenta invitada).
 *
 * AISLAMIENTO: todos los actores son cuentas SANDBOX (profiles.is_sandbox,
 * migración 20260924120000). La prueba se NIEGA a correr si alguno no lo es.
 * Con eso, ningún usuario real recibe notificaciones, toasts ni cambios de
 * contador mientras corre — se verifica después de CADA paso que reparte a
 * admins, no solo al final.
 *
 * Los experimentos de mantenimiento/backfill y de fallo forzado corren en SQL
 * dentro de un bloque que se revierte entero (`raise exception 'RESULT:…'`):
 * no dejan rastro en la base.
 */
import { createClient } from "@supabase/supabase-js";
import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createTestProduct, deleteTestProducts, EXAMPLE_PRICING } from "./fixtures/commission-test-products.mjs";

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
const ADMIN2 = "e2e-sm-admin@motods.test";
const ZELLE = "2ab4abc7-f6a4-41a9-84b0-e0d2d0668fce";
const SYNCHRONY = "68800b33-efb0-4e62-9a68-b4b65ef5657c"; // SYNCHRONY NUEVO MUEBLES
const SYNCHRONY_12M = "c2a9c2c8-af98-4c31-9d3b-7a9e9dad9070";
const KAFENE = "b99a7002-2c8b-4f10-94ab-a49a77529a81"; // KAFENE EMOTION

const svc = createClient(URL, SERVICE, { auth: { persistSession: false } });
async function signIn(email) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password: values.password });
  if (error) throw new Error(`login ${email}: ${error.message}`);
  c.realtime.setAuth(data.session.access_token);
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sameSet = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

const created = { sales: [], products: [], liquidations: [], users: [], invitationEmails: [] };
let realInboxBefore = null;
let realUserIds = [];

/** Notificaciones (vía service role, para verificar) con filtros simples. */
async function notes(filter) {
  let q = svc.from("notifications").select("*");
  for (const [k, v] of Object.entries(filter)) q = q.eq(k, v);
  const { data } = await q;
  return data ?? [];
}
/** Bandeja de los usuarios REALES (no sandbox): ids y no leídas por usuario. */
async function realInbox() {
  const { data } = await svc.from("notifications").select("id, recipient_user_id, read_at").in("recipient_user_id", realUserIds);
  const unread = {};
  for (const n of data ?? []) if (!n.read_at) unread[n.recipient_user_id] = (unread[n.recipient_user_id] ?? 0) + 1;
  return JSON.stringify({ ids: (data ?? []).map((n) => n.id).sort(), unread });
}
async function assertRealUntouched(step) {
  check(`aislamiento: la bandeja y el contador de los usuarios reales no cambiaron (${step})`, (await realInbox()) === realInboxBefore);
}

/**
 * Ejecuta SQL como postgres (CLI enlazada) dentro de un DO que termina en
 * `raise exception 'RESULT:<json>'`: todo se revierte y el JSON vuelve en el
 * mensaje de error.
 */
function sqlProbe(sql) {
  const file = path.join(os.tmpdir(), `notif-probe-${Date.now()}.sql`);
  fs.writeFileSync(file, sql);
  let out = "";
  try {
    out = execSync(`npx supabase db query --linked --file "${file}"`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
  } finally {
    fs.rmSync(file, { force: true });
  }
  const line = out.split(/\r?\n/).find((l) => l.includes("RESULT:"));
  if (!line) throw new Error(`sqlProbe sin resultado: ${out.slice(0, 400)}`);
  const outer = JSON.parse(line);
  const inner = JSON.parse(outer.error.message.replace(/^[^{]*/, ""));
  const m = /RESULT:(\{[\s\S]*?\})\s*\nCONTEXT/.exec(inner.message);
  return JSON.parse(m[1]);
}

function watch(client, recipientId, label) {
  const got = [];
  let resolveReady;
  const ready = new Promise((r) => (resolveReady = r));
  const channel = client.c
    .channel(`test-${label}-${Date.now()}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `recipient_user_id=eq.${recipientId}` }, (p) => got.push(p.new))
    .subscribe((status) => {
      if (status === "SUBSCRIBED") resolveReady(true);
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") resolveReady(false);
    });
  return { got, ready: Promise.race([ready, sleep(15000).then(() => false)]), stop: () => client.c.removeChannel(channel) };
}

async function main() {
  const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  for (const [email, role, name] of [[SELLER2, "seller", "Vendedor Smile E2E 2"], [ADMIN2, "admin", "admin E2E"]]) {
    execFileSync("node", ["--env-file=.env.local", "supabase/scripts/create-user.mjs", "--sandbox", "--email", email, "--password", values.password, "--role", role, "--name", name], { cwd, stdio: "ignore" });
  }
  const admin = await signIn(values.admin);
  // Desde 2026-09-21 el mensaje lleva el NOMBRE de quien actuó, no un genérico.
  const adminName = (await svc.rpc("person_display_name", { p_profile_id: admin.id })).data ?? "Administración";
  const admin2 = await signIn(ADMIN2);
  const seller = await signIn(values.seller);
  const seller2 = await signIn(SELLER2);
  // Salvaguarda: solo corre con actores SANDBOX (si no, podría notificar a
  // usuarios reales). Nunca se deduce del correo: es la marca de la cuenta.
  const { data: actors } = await svc.from("profiles").select("id, email, is_sandbox").in("id", [admin.id, admin2.id, seller.id, seller2.id]);
  const notSandbox = (actors ?? []).filter((p) => !p.is_sandbox).map((p) => p.email);
  if (notSandbox.length) throw new Error(`Cuentas de prueba sin marca sandbox (ejecuta create-user --sandbox): ${notSandbox.join(", ")}`);
  check("salvaguarda: todos los actores de la prueba son cuentas sandbox", notSandbox.length === 0);

  const { data: realRows } = await svc.from("profiles").select("id").eq("is_sandbox", false);
  realUserIds = (realRows ?? []).map((p) => p.id);
  realInboxBefore = await realInbox();

  // Reparto a admins = todos los admins activos de la partición del vendedor.
  const { data: adminRows } = await svc.from("profiles").select("id").eq("role", "admin").eq("account_status", "ACTIVE").eq("is_sandbox", true);
  const admins = (adminRows ?? []).map((a) => a.id);
  const { count: realAdmins } = await svc.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin").eq("account_status", "ACTIVE").eq("is_sandbox", false);
  check(`partición: ${admins.length} admins de prueba reciben; ${realAdmins} admin(s) real(es) quedan fuera`, admins.length >= 2);
  const { data: sellerProfile } = await svc.from("profiles").select("full_name").eq("id", seller.id).single();
  const sellerName = sellerProfile.full_name;

  // Realtime: la propia suscripción del vendedor y un "espía" (vendedor B)
  // que pide las del vendedor A cambiando el filtro. RLS debe impedirlo.
  const own = watch(seller, seller.id, "own");
  const spy = watch(seller2, seller.id, "spy");
  const [ownReady, spyReady] = await Promise.all([own.ready, spy.ready]);
  check("Realtime: suscripciones establecidas", ownReady === true && spyReady === true, { ownReady, spyReady });

  const stamp = Date.now().toString(36).toUpperCase();
  const P = await createTestProduct(admin.c, { name: `E2E NOTIF ${stamp}`, pricing: EXAMPLE_PRICING }); // $4,500 / $500
  created.products.push(P.productId);

  async function makeSale({ buyer, allocations, submit = true, by = seller }) {
    const { data: saleId, error } = await by.c.rpc("create_sale_draft", { p_operation_type: "CUBA" });
    if (error) throw new Error(error.message);
    created.sales.push(saleId);
    const saved = await rpc(by.c, "save_cuba_sale_draft", {
      p_sale_id: saleId,
      p_payload: {
        saleDate: new Date().toISOString().slice(0, 10), shareCommission: false, internalNotes: "Venta de prueba de notificaciones",
        buyer: {
          firstName: "E2E", lastName: `${buyer} ${stamp}`, dateOfBirth: "1990-01-01", documentNumber: "E2E-NT-1",
          documentExpiration: "2031-01-01", phone: "(305) 555-0108", email: "", addressLine1: "1 Test St",
          addressLine2: "", city: "Miami", state: "FL", postalCode: "33101",
        },
        coBuyer: null,
        units: [{ productId: P.productId, variantId: P.variantId, agreedPriceCents: 470000 }],
        extras: [],
        cubaRecipient: {
          fullName: "Destinatario E2E", identityNumber: "90010112345", deliveryAddress: "Calle 1 #2",
          municipality: "Plaza", province: "La Habana", phonePrimary: "+53 55555555", phoneSecondary: "",
        },
        delivery: { method: "HOME_DELIVERY", reference: "" },
        paymentAllocations: allocations ?? [{ id: null, paymentMethodId: ZELLE, planId: null, inputMode: "NET", amountCents: 470000, reference: "E2E", notes: "" }],
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

  // ------------------------------------------------------------------ 1
  console.log("\nTEST 1 · Nueva venta (DRAFT → PENDING) → cada admin activo");
  const D = await makeSale({ buyer: "Borrador", submit: false });
  check("un BORRADOR guardado no notifica a nadie", (await notes({ sale_id: D })).length === 0);
  const F = await makeSale({
    buyer: "Financiada",
    allocations: [
      { id: null, paymentMethodId: SYNCHRONY, planId: SYNCHRONY_12M, inputMode: "NET", amountCents: 235000, reference: "E2E", notes: "" },
      { id: null, paymentMethodId: KAFENE, planId: null, inputMode: "NET", amountCents: 235000, reference: "E2E", notes: "" },
    ],
  });
  const submitted = await notes({ sale_id: F, type: "SALE_SUBMITTED" });
  check(`una por cada admin activo (${admins.length})`, submitted.length === admins.length && sameSet(submitted.map((x) => x.recipient_user_id), admins), submitted.map((x) => x.recipient_user_id));
  check("título, mensaje y enlace a la ficha admin",
    submitted.every((x) => x.title === "Nueva venta" && x.message === `${sellerName} envió la venta de E2E Financiada ${stamp}.` && x.destination_url === `/admin/ventas/${F}`), submitted[0]);
  check("el vendedor NO recibe su propia acción", (await notes({ sale_id: F, recipient_user_id: seller.id })).length === 0);
  await assertRealUntouched("tras 'Nueva venta'");

  // ------------------------------------------------------------------ 15
  console.log("\nTEST 15 · Acción fallida → sin notificación");
  let r = await rpc(admin.c, "admin_mark_sale_paid", { p_sale_id: F });
  check("PAGADA de una venta PENDIENTE con financiamiento sin acreditar → rechazada", r.ok === false, r);
  r = await rpc(seller.c, "mark_sale_sold", { p_sale_id: F });
  check("VENDIDA con contratos sin firmar → rechazada (CONTRACT_UNSIGNED)", r.ok === false && r.code === "CONTRACT_UNSIGNED", r);
  check("ninguna de las dos acciones fallidas notificó",
    (await notes({ sale_id: F, type: "SALE_MARKED_PAID" })).length === 0 && (await notes({ sale_id: F, type: "SALE_MARKED_SOLD" })).length === 0);

  // ------------------------------------------------------------------ 2
  console.log("\nTEST 2 · Contrato ENVIADO → solo el vendedor dueño (uno por contrato)");
  const buyerPhrase = `la venta de E2E Financiada ${stamp}`; // aún sin número: se asigna al confirmarla
  const { data: allocs } = await svc.from("sale_payment_allocations").select("id, payment_method_id").eq("sale_id", F);
  const allocSync = allocs.find((a) => a.payment_method_id === SYNCHRONY)?.id;
  const allocKaf = allocs.find((a) => a.payment_method_id === KAFENE)?.id;
  r = await rpc(admin.c, "mark_financing_sent", { p_sale_id: F, p_payment_allocation_id: allocSync });
  check("contrato Synchrony enviado", r.ok === true, r);
  const cSync = r.contractId;
  let n = await notes({ sale_id: F, type: "CONTRACT_SENT" });
  check("el vendedor recibe 'Contrato enviado' de Synchrony",
    n.length === 1 && n[0].recipient_user_id === seller.id
      && n[0].message === adminName + " envió el contrato de SYNCHRONY NUEVO MUEBLES para " + buyerPhrase + "."
      && n[0].destination_url === "/seller/ventas/" + F, n);
  check("el vendedor B no recibe nada", (await notes({ recipient_user_id: seller2.id, sale_id: F })).length === 0);
  r = await rpc(admin.c, "mark_financing_sent", { p_sale_id: F, p_payment_allocation_id: allocKaf });
  const cKaf = r.contractId;
  n = await notes({ sale_id: F, type: "CONTRACT_SENT" });
  check("un segundo contrato (Kafene) → su propia notificación", n.length === 2 && n.some((x) => x.message.includes("KAFENE EMOTION")), n.map((x) => x.message));

  // ------------------------------------------------------------------ 14
  console.log("\nTEST 14 · Reintentos → una sola notificación");
  r = await rpc(admin.c, "mark_financing_sent", { p_sale_id: F, p_payment_allocation_id: allocSync });
  check("reenviar el mismo contrato → ALREADY_SENT", r.ok === false && r.code === "ALREADY_SENT", r);
  check("sigue habiendo 2 'Contrato enviado'", (await notes({ sale_id: F, type: "CONTRACT_SENT" })).length === 2);
  const one = (await notes({ sale_id: F, type: "CONTRACT_SENT" }))[0];
  const dup = await svc.from("notifications").insert({
    recipient_user_id: one.recipient_user_id, type: one.type, title: "x", message: "x", event_key: one.event_key,
  });
  check("la base rechaza un duplicado (destinatario, event_key)", Boolean(dup.error) && /duplicate|unique/i.test(dup.error.message), dup.error?.message);

  // ------------------------------------------------------------------ 3
  console.log("\nTEST 3 · Contratos FIRMADOS → vendedor");
  r = await rpc(admin.c, "mark_financing_signed", { p_contract_id: cSync });
  n = await notes({ sale_id: F, type: "CONTRACT_SIGNED" });
  check("'Contrato firmado' al vendedor", r.ok === true && n.length === 1 && n[0].recipient_user_id === seller.id
    && n[0].message === "El contrato de SYNCHRONY NUEVO MUEBLES de " + buyerPhrase + " fue marcado como firmado.", n);
  r = await rpc(admin.c, "mark_financing_signed", { p_contract_id: cKaf });
  check("firmar Kafene → su propia notificación", r.ok === true && (await notes({ sale_id: F, type: "CONTRACT_SIGNED" })).length === 2, r);

  // ------------------------------------------------------------------ 6
  console.log("\nTEST 6 · El vendedor confirma su venta → admins (no a sí mismo)");
  r = await rpc(seller.c, "mark_sale_sold", { p_sale_id: F });
  check("marcada VENDIDA", r.ok === true, r);
  const numberF = r.saleNumber;
  n = await notes({ sale_id: F, type: "SALE_MARKED_SOLD" });
  check("una por admin, 'Venta confirmada'", n.length === admins.length && sameSet(n.map((x) => x.recipient_user_id), admins) && n.every((x) => x.title === "Venta confirmada"), n.length);
  check("mensaje con el número de venta", n.length > 0 && Boolean(numberF) && n.every((x) => x.message === sellerName + " marcó la venta " + numberF + " como vendida."), n[0]?.message);
  check("el vendedor no recibe notificación de su propia confirmación", (await notes({ sale_id: F, recipient_user_id: seller.id, type: "SALE_MARKED_SOLD" })).length === 0);
  await assertRealUntouched("tras 'Venta confirmada'");

  console.log("\n· Semántica de comisión (lo que afirma el texto de 'Venta pagada')");
  const { data: commF } = await svc.from("sale_commissions").select("id, status, eligible_at, liquidation_id").eq("sale_id", F);
  check("al quedar VENDIDA la comisión existe en PENDING, sin eligible_at", commF.length === 2 || commF.length === 1
    ? commF.every((c) => c.status === "PENDING" && c.eligible_at === null) : false, commF);
  const Wcur = (await rpc(seller.c, "seller_weekly_liquidation", {})).currentWeekStart;
  const cur = await rpc(admin.c, "admin_liquidation_create_draft", { p_seller_id: seller.id, p_week_start: Wcur });
  if (cur.liquidationId) created.liquidations.push(cur.liquidationId);
  const { data: claimed } = await svc.from("sale_commissions").select("liquidation_id, status").eq("sale_id", F);
  check("la liquidación de la semana de CONFIRMACIÓN (sold_at) ya la reclama, aún PENDING (sin esperar el cobro)",
    Boolean(cur.liquidationId) && claimed.every((c) => c.liquidation_id === cur.liquidationId && c.status === "PENDING"), { cur, claimed });
  r = await rpc(seller.c, "mark_sale_sold", { p_sale_id: F });
  check("TEST 14 · reintento idempotente de 'marcar vendida' (alreadySold) → sin duplicar",
    r.ok === true && r.alreadySold === true && (await notes({ sale_id: F, type: "SALE_MARKED_SOLD" })).length === admins.length, r);
  r = await rpc(admin.c, "admin_mark_sale_paid", { p_sale_id: F });
  check("PAGADA con financiamiento sin acreditar → rechazada, sin notificación", r.ok === false && (await notes({ sale_id: F, type: "SALE_MARKED_PAID" })).length === 0, r);

  // ------------------------------------------------------------------ 4
  console.log("\nTEST 4 · ACREDITADO → vendedor");
  r = await rpc(admin.c, "mark_financing_accredited", { p_contract_id: cSync });
  n = await notes({ sale_id: F, type: "CONTRACT_ACCREDITED" });
  check("'Financiamiento acreditado' al vendedor", r.ok === true && n.length === 1
    && n[0].message === "SYNCHRONY NUEVO MUEBLES acreditó el financiamiento de la venta " + numberF + ".", n);
  check("con un contrato aún sin acreditar, la venta no se da por pagada", (await notes({ sale_id: F, type: "SALE_MARKED_PAID" })).length === 0);

  // ------------------------------------------------------------------ 7
  console.log("\nTEST 7 · Venta PAGADA → vendedor (con elegibilidad de comisión)");
  r = await rpc(admin.c, "mark_financing_accredited", { p_contract_id: cKaf });
  check("último contrato acreditado → lista para pagar (sin notificar aún 'pagada')",
    r.ok === true && r.readyForPaid === true && (await notes({ sale_id: F, type: "SALE_MARKED_PAID" })).length === 0, r);
  r = await rpc(admin.c, "admin_mark_sale_paid", { p_sale_id: F });
  const { data: saleF } = await svc.from("sales").select("status").eq("id", F).single();
  n = await notes({ sale_id: F, type: "SALE_MARKED_PAID" });
  check("administración la marca PAGADA", r.ok === true && saleF.status === "PAID", { r, saleF });
  const { data: saleFpaid } = await svc.from("sales").select("paid_at").eq("id", F).single();
  const { data: commPaid } = await svc.from("sale_commissions").select("status, eligible_at, liquidation_id").eq("sale_id", F);
  check("al PAGARSE la comisión pasa a ELIGIBLE con eligible_at = paid_at y sigue en la liquidación de su semana de confirmación",
    commPaid.every((c) => c.status === "ELIGIBLE" && Date.parse(c.eligible_at) === Date.parse(saleFpaid.paid_at) && c.liquidation_id === cur.liquidationId), { commPaid, paidAt: saleFpaid.paid_at });
  r = await rpc(admin.c, "admin_mark_sale_paid", { p_sale_id: F });
  check("TEST 14 · marcarla pagada otra vez no duplica", (await notes({ sale_id: F, type: "SALE_MARKED_PAID" })).length === 1, r);
  check("una sola 'Venta pagada' al vendedor, que menciona la comisión",
    n.length === 1 && n[0].recipient_user_id === seller.id && n[0].title === "Venta pagada"
      && n[0].message.startsWith("La venta " + numberF + " fue marcada como pagada.") && /comisión ya es elegible/.test(n[0].message), n);
  const typesF = (await notes({ sale_id: F, recipient_user_id: seller.id })).map((x) => x.type).sort();
  check("sin notificación redundante de 'comisión elegible'",
    JSON.stringify(typesF) === JSON.stringify(["CONTRACT_ACCREDITED", "CONTRACT_ACCREDITED", "CONTRACT_SENT", "CONTRACT_SENT", "CONTRACT_SIGNED", "CONTRACT_SIGNED", "SALE_MARKED_PAID"]), typesF);

  // ------------------------------------------------------------------ 5
  console.log("\nTEST 5 · Administración confirma la venta → vendedor");
  const A = await makeSale({ buyer: "Confirmada" });
  r = await rpc(admin.c, "mark_sale_sold", { p_sale_id: A });
  const numberA = r.saleNumber;
  n = await notes({ sale_id: A, type: "SALE_MARKED_SOLD" });
  check("'Venta confirmada' solo al vendedor", r.ok === true && n.length === 1 && n[0].recipient_user_id === seller.id
    && n[0].message === `${adminName} confirmó la venta ${numberA}.` && n[0].destination_url === `/seller/ventas/${A}`, n);

  console.log("\n· Venta devuelta a borrador → vendedor (con motivo)");
  const R = await makeSale({ buyer: "Devuelta" });
  r = await rpc(admin.c, "return_sale_to_draft", { p_sale_id: R, p_reason: "Falta la firma del cliente" });
  n = await notes({ sale_id: R, type: "SALE_RETURNED_TO_DRAFT" });
  check("'Venta devuelta' con el motivo", r.ok === true && n.length === 1 && n[0].recipient_user_id === seller.id
    && n[0].message === `${adminName} devolvió la venta de E2E Devuelta ${stamp} a borrador. Motivo: Falta la firma del cliente`, n);

  console.log("\n· Corrección administrativa directa → vendedor (una por edición, no por notas internas)");
  r = await rpc(admin.c, "admin_update_cuba_sale", { p_sale_id: A, p_reason: "Datos del cliente", p_payload: { buyer: { phone: "(305) 555-0199", city: "Hialeah" } } });
  n = await notes({ sale_id: A, type: "ADMIN_SALE_CORRECTED" });
  check("edición de 2 campos → UNA 'Venta actualizada'", r.ok === true && n.length === 1 && n[0].recipient_user_id === seller.id
    && n[0].message === `${adminName} actualizó la venta ${numberA}.`, { r, n: n.length });
  r = await rpc(admin.c, "admin_update_cuba_sale", { p_sale_id: A, p_reason: "Nota", p_payload: { internalNotes: `Nota interna ${stamp}` } });
  check("solo notas internas → sin notificación", r.ok === true && (await notes({ sale_id: A, type: "ADMIN_SALE_CORRECTED" })).length === 1, r);

  // ------------------------------------------------------------------ 8
  console.log("\nTEST 8 · Solicitud de edición → admins; rechazo / aprobación → vendedor");
  const { data: pA } = await svc.from("sale_parties").select("phone").eq("sale_id", A).eq("party_role", "PRIMARY_BUYER").single();
  r = await rpc(seller.c, "request_sale_edit", { p_sale_id: A, p_reason: "Cambio de teléfono", p_changes: [{ path: "buyer.phone", oldValue: pA.phone, newValue: "(305) 555-0111" }] });
  const req1 = r.requestId;
  n = await notes({ sale_id: A, type: "SALE_EDIT_REQUESTED" });
  check("'Edición pendiente' a cada admin, con enlace a Aprobaciones",
    r.ok === true && sameSet(n.map((x) => x.recipient_user_id), admins)
      && n.every((x) => x.message === `${sellerName} solicitó modificar la venta ${numberA}.` && x.destination_url === `/admin/aprobaciones/ediciones/${req1}`), n[0]);
  await assertRealUntouched("tras 'Edición pendiente'");
  r = await rpc(admin.c, "reject_sale_edit_request", { p_request_id: req1, p_review_note: "El documento no coincide" });
  n = await notes({ sale_id: A, type: "SALE_EDIT_REJECTED" });
  check("'Edición rechazada' al vendedor con el motivo", r.ok === true && n.length === 1 && n[0].recipient_user_id === seller.id
    && n[0].message === `${adminName} rechazó la solicitud de cambios de la venta ${numberA}. Motivo: El documento no coincide`, n);
  r = await rpc(admin.c, "reject_sale_edit_request", { p_request_id: req1, p_review_note: "otra vez" });
  check("rechazar de nuevo → falla y no duplica", r.ok === false && (await notes({ sale_id: A, type: "SALE_EDIT_REJECTED" })).length === 1, r);
  r = await rpc(seller.c, "request_sale_edit", { p_sale_id: A, p_reason: "Cambio de teléfono", p_changes: [{ path: "buyer.phone", oldValue: pA.phone, newValue: "(305) 555-0112" }] });
  r = await rpc(admin.c, "approve_sale_edit_request", { p_request_id: r.requestId });
  n = await notes({ sale_id: A, type: "SALE_EDIT_APPROVED" });
  check("'Edición aprobada' al vendedor", r.ok === true && n.length === 1
    && n[0].message === `${adminName} aprobó los cambios solicitados para la venta ${numberA}.`, n);
  check("aprobar una solicitud no genera además 'Venta actualizada'", (await notes({ sale_id: A, type: "ADMIN_SALE_CORRECTED" })).length === 1);

  // ------------------------------------------------------------------ 9
  console.log("\nTEST 9 · Liquidación aprobada y pagada → vendedor");
  // Solo se aprueba una semana ya CERRADA: la anterior, con un bono (como en
  // la prueba de liquidación semanal).
  const W = (await rpc(seller.c, "seller_weekly_liquidation", {})).currentWeekStart;
  const prevWeek = new Date(W + "T00:00:00Z");
  prevWeek.setUTCDate(prevWeek.getUTCDate() - 7);
  r = await rpc(admin.c, "admin_liquidation_create_draft", { p_seller_id: seller.id, p_week_start: prevWeek.toISOString().slice(0, 10) });
  const L = r.liquidationId;
  if (L) created.liquidations.push(L);
  await rpc(admin.c, "admin_liquidation_add_adjustment", { p_liquidation_id: L, p_type: "BONO_MARKETING", p_amount_cents: 12345, p_reason: "Bono E2E notificaciones" });
  check("borrador de la semana anterior (cerrada) con un bono", Boolean(L) && (await notes({ entity_id: L })).length === 0, r);
  r = await rpc(admin.c, "admin_liquidation_approve", { p_liquidation_id: L });
  const { data: liq } = await svc.from("weekly_liquidations").select("*").eq("id", L).single();
  const money = `$${(liq.total_to_pay_cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const mmdd = (d) => `${d.slice(5, 7)}/${d.slice(8, 10)}`;
  n = await notes({ entity_id: L, type: "LIQUIDATION_APPROVED" });
  check("'Liquidación aprobada' con semana y monto", r.ok === true && n.length === 1 && n[0].recipient_user_id === seller.id
    && n[0].message === `Tu liquidación semanal del ${mmdd(liq.week_start_date)} al ${mmdd(liq.week_end_date)} fue aprobada por ${money}.`
    && n[0].destination_url === `/seller/liquidaciones/${L}`, { msg: n[0]?.message, money });
  r = await rpc(admin.c, "admin_liquidation_approve", { p_liquidation_id: L });
  check("aprobar de nuevo → falla y no duplica", r.ok === false && (await notes({ entity_id: L, type: "LIQUIDATION_APPROVED" })).length === 1, r);
  r = await rpc(admin.c, "admin_liquidation_mark_paid", { p_liquidation_id: L, p_payment_reference: `E2E-${stamp}` });
  n = await notes({ entity_id: L, type: "LIQUIDATION_PAID" });
  check("'Liquidación pagada' (segunda notificación)", r.ok === true && n.length === 1 && n[0].message.startsWith(`Tu liquidación semanal por ${money}`), n[0]?.message);

  // ------------------------------------------------------------------ 13
  console.log("\nTEST 13 · Seguridad: el vendedor B no ve ni toca las del vendedor A");
  const target = (await notes({ sale_id: F, type: "CONTRACT_SENT" }))[0];
  let q = await seller2.c.from("notifications").select("id").eq("recipient_user_id", seller.id);
  check("B consulta las de A → 0 filas", !q.error && q.data.length === 0, q.error ?? q.data.length);
  q = await seller2.c.from("notifications").select("id").eq("id", target.id);
  check("B consulta una de A por id → 0 filas", !q.error && q.data.length === 0);
  r = await rpc(seller2.c, "notification_mark_read", { p_notification_id: target.id });
  const stillUnread = (await svc.from("notifications").select("read_at").eq("id", target.id).single()).data.read_at === null;
  check("B no puede marcar leída una de A", r.ok === true && r.updated === 0 && stillUnread, r);
  const ins = await seller2.c.from("notifications").insert({ recipient_user_id: seller.id, type: "SALE_SUBMITTED", title: "x", message: "x" });
  check("B no puede crear notificaciones", Boolean(ins.error), ins.error?.message);
  const upd = await seller.c.from("notifications").update({ title: "hackeado" }).eq("id", target.id).select();
  const titleNow = (await svc.from("notifications").select("title").eq("id", target.id).single()).data.title;
  check("ni el propio destinatario puede cambiar el texto", (Boolean(upd.error) || (upd.data ?? []).length === 0) && titleNow === "Contrato enviado", upd.error?.message);
  const del = await seller.c.from("notifications").delete().eq("id", target.id).select();
  const exists = (await svc.from("notifications").select("id").eq("id", target.id)).data.length === 1;
  check("ni borrarla", (Boolean(del.error) || (del.data ?? []).length === 0) && exists, del.error?.message);
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  q = await anon.from("notifications").select("id").limit(1);
  check("anónimo → nada", Boolean(q.error) || q.data.length === 0);
  for (const fn of ["_notify", "_notify_admins"]) {
    const res = await seller.c.rpc(fn, {});
    check(`la función interna ${fn} no se puede invocar`, Boolean(res.error), res.error?.message);
  }

  await sleep(3000);
  check("Realtime: el vendedor A recibió sus notificaciones en vivo", own.got.length >= 8 && own.got.every((x) => x.recipient_user_id === seller.id), own.got.length);
  check("Realtime: el vendedor B NO recibió ninguna de A aunque pidió ese filtro", spy.got.length === 0, spy.got.length);
  await own.stop();
  await spy.stop();

  // ------------------------------------------------------------------ 10 / 11
  console.log("\nTEST 10-11 · Lectura, contador y 'marcar todas'");
  const count = async (who) => rpc(who.c, "notification_unread_count", {});
  const { count: realUnread } = await svc.from("notifications").select("id", { count: "exact", head: true }).eq("recipient_user_id", seller.id).is("read_at", null);
  const c0 = await count(seller);
  check(`contador = no leídas reales (${realUnread})`, c0 === realUnread, c0);
  r = await rpc(seller.c, "notification_mark_read", { p_notification_id: target.id });
  check("marcar una → baja en 1", r.ok === true && r.updated === 1 && (await count(seller)) === c0 - 1, r);
  r = await rpc(seller.c, "notification_mark_read", { p_notification_id: target.id });
  check("marcarla otra vez no cambia nada", r.updated === 0 && (await count(seller)) === c0 - 1);
  const b0 = await count(seller2);
  r = await rpc(seller.c, "notification_mark_all_read", {});
  check("'marcar todas' → 0", r.ok === true && (await count(seller)) === 0, r);
  check("…y no toca las de otro usuario", (await count(seller2)) === b0);

  console.log("\n· Cada admin tiene su propia copia");
  const [mine] = await notes({ sale_id: F, type: "SALE_SUBMITTED", recipient_user_id: admin.id });
  await rpc(admin.c, "notification_mark_read", { p_notification_id: mine.id });
  const [theirs] = await notes({ sale_id: F, type: "SALE_SUBMITTED", recipient_user_id: admin2.id });
  check("un admin la lee → la del otro admin sigue sin leer", theirs && theirs.read_at === null);

  // ------------------------------------------------------------------ activación
  console.log("\n· Vendedor activa su cuenta → admins");
  const invEmail = `e2e-notif-invitado-${stamp.toLowerCase()}@motods.test`;
  created.invitationEmails.push(invEmail);
  const { data: link } = await svc.auth.admin.generateLink({ type: "invite", email: invEmail, options: { data: { full_name: "Invitado Notif", role: "seller", account_status: "INVITED" } } });
  created.users.push(link.user.id);
  await rpc(admin.c, "admin_record_seller_invitation", { p_seller_id: link.user.id, p_email: invEmail });
  const guest = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: otp } = await guest.auth.verifyOtp({ type: "invite", token_hash: link.properties.hashed_token });
  await guest.auth.setSession(otp.session);
  await guest.auth.updateUser({ password: `${values.password}x` });
  r = await rpc(guest, "accept_seller_invitation", {});
  n = await notes({ entity_id: link.user.id, type: "SELLER_ACTIVATED" });
  const { data: invitedProfile } = await svc.from("profiles").select("is_sandbox").eq("id", link.user.id).single();
  check("la cuenta invitada por un admin sandbox hereda la marca sandbox", invitedProfile.is_sandbox === true);
  check("'Vendedor activado' a cada admin", r.ok === true && sameSet(n.map((x) => x.recipient_user_id), admins)
    && n.every((x) => x.message === "Invitado Notif activó su cuenta y ya puede registrar ventas." && x.destination_url === `/admin/vendedores/${link.user.id}`), n.length);
  await assertRealUntouched("tras 'Vendedor activado'");

  // ------------------------------------------------------------------ 13
  console.log("\nTEST 13 · Mantenimiento / historial reinsertado → NO notifica");
  const { error: svcInsErr } = await svc.from("sale_status_history").insert({ sale_id: D, from_status: "DRAFT", to_status: "PENDING", changed_by: seller.id });
  check("fila de historial insertada por un script de servicio (sin sesión) → 0 notificaciones",
    !svcInsErr && (await notes({ sale_id: D })).length === 0, svcInsErr?.message);
  const probe = sqlProbe(`
do $$
declare
  v_sale uuid := '${D}';
  v_admin uuid := '${admin.id}';
  v_seller uuid := '${seller.id}';
  v_old int; v_supp int; v_ctrl int;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_seller, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_seller::text, true);
  insert into public.sale_status_history (sale_id, from_status, to_status, changed_by, created_at)
    values (v_sale, 'DRAFT', 'PENDING', v_seller, now() - interval '30 days');
  v_old := (select count(*) from public.notifications where sale_id = v_sale);
  perform set_config('motods.suppress_notifications', 'on', true);
  insert into public.sale_status_history (sale_id, from_status, to_status, changed_by) values (v_sale, 'DRAFT', 'PENDING', v_seller);
  v_supp := (select count(*) from public.notifications where sale_id = v_sale);
  perform set_config('motods.suppress_notifications', 'off', true);
  insert into public.sale_status_history (sale_id, from_status, to_status, changed_by) values (v_sale, 'DRAFT', 'PENDING', v_seller);
  v_ctrl := (select count(*) from public.notifications where sale_id = v_sale);
  raise exception 'RESULT:%', jsonb_build_object('uid', auth.uid(), 'oldEvent', v_old, 'suppressed', v_supp, 'control', v_ctrl);
end $$;`);
  check("con sesión de usuario, un evento de hace 30 días (backfill) → 0 notificaciones", probe.uid === seller.id && probe.oldEvent === 0, probe);
  check("con silencio de mantenimiento explícito → 0 notificaciones", probe.suppressed === 0, probe);
  check(`control: el mismo evento, actual y sin silencio → sí notifica (${admins.length} admins)`, probe.control === admins.length, probe);
  check("todo el experimento SQL se revirtió (sin rastro)", (await notes({ sale_id: D })).length === 0);

  // ------------------------------------------------------------------ 15
  console.log("\nTEST 15b · Falla la notificación → la operación de negocio sigue y queda registrado");
  const X = await makeSale({ buyer: "Fallo" });
  const failure = sqlProbe(`
do $$
declare
  v_sale uuid := '${X}';
  v_admin uuid := '${admin.id}';
  r jsonb; v_status text; v_n int; v_err int;
begin
  alter table public.notifications add constraint zz_probe_force_failure check (false) not valid;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  r := public.return_sale_to_draft(v_sale, 'Prueba de fallo forzado');
  select status into v_status from public.sales where id = v_sale;
  v_n := (select count(*) from public.notifications where sale_id = v_sale and type = 'SALE_RETURNED_TO_DRAFT');
  v_err := (select count(*) from public.notification_delivery_errors
            where source = 'notifications_on_sale_status' and context->>'saleId' = v_sale::text and sqlstate = '23514');
  raise exception 'RESULT:%', jsonb_build_object('rpc', r, 'status', v_status, 'notifications', v_n, 'errorsLogged', v_err);
end $$;`);
  check("con la inserción de notificaciones rota, 'devolver a borrador' igual se completa (ok, DRAFT)", failure.rpc?.ok === true && failure.status === "DRAFT", failure);
  check("…sin notificación y con el fallo registrado en notification_delivery_errors (check_violation)", failure.notifications === 0 && failure.errorsLogged === 1, failure);
  const { data: xNow } = await svc.from("sales").select("status").eq("id", X).single();
  check("el experimento se revirtió: la venta sigue PENDIENTE y la restricción forzada no existe", xNow.status === "PENDING");
  r = await rpc(admin.c, "return_sale_to_draft", { p_sale_id: X, p_reason: "Control" });
  check("…y fuera del experimento notifica normalmente", r.ok === true && (await notes({ sale_id: X, type: "SALE_RETURNED_TO_DRAFT" })).length === 1, r);
}

async function cleanup() {
  console.log("\n· Limpiando datos de prueba");
  for (const id of created.sales) await svc.from("sales").delete().eq("id", id);
  for (const id of created.liquidations) await svc.from("weekly_liquidations").delete().eq("id", id);
  for (const e of await deleteTestProducts(svc, created.products)) console.log(`  ! ${e}`);
  for (const email of created.invitationEmails) await svc.from("seller_invitations").delete().eq("email", email);
  for (const id of created.users) await svc.auth.admin.deleteUser(id);

  const saleIds = created.sales.length ? created.sales : ["00000000-0000-0000-0000-000000000000"];
  const { data: leftSales } = await svc.from("notifications").select("id").in("sale_id", saleIds);
  const entityIds = [...created.liquidations, ...created.users];
  const { data: leftEntities } = entityIds.length ? await svc.from("notifications").select("id").in("entity_id", entityIds) : { data: [] };
  check("no quedan notificaciones de los datos de prueba (ventas, liquidación, vendedor)", (leftSales ?? []).length === 0 && (leftEntities ?? []).length === 0, { leftSales, leftEntities });
  if (realInboxBefore) {
    const after = await realInbox();
    check("la bandeja de los usuarios reales quedó exactamente igual", JSON.stringify(after) === JSON.stringify(realInboxBefore), { before: realInboxBefore.length, after: after.length });
  }
}

try {
  await main();
} catch (e) {
  fail++;
  console.log(`\n✘ ERROR: ${e instanceof Error ? e.stack : String(e)}`);
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
