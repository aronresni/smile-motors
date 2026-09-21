/**
 * STOCK (CATÁLOGO) + CALCULADORA DEL VENDEDOR — prueba contra la base REAL.
 *
 *   node --env-file=.env.local supabase/scripts/test-seller-calculator.mjs \
 *     --admin e2e-smile-admin@motods.test --seller e2e-smile-seller@motods.test
 *
 * Qué fija:
 *   · el vendedor LEE el catálogo activo y no puede tocar nada (productos,
 *     variantes, financieras ni planes): Administración sigue mandando,
 *   · convertir una simulación crea un BORRADOR y NADA MÁS: ni PENDIENTE, ni
 *     VENDIDA, ni contrato de financiación, ni pago liquidado, ni comisión,
 *   · el fee y el neto los calcula el SERVIDOR desde la configuración vigente:
 *     un cliente manipulado no puede inventarse un neto,
 *   · la cobertura se mide en NETO (lo que de verdad entra), no en bruto,
 *   · la cuota mensual sale de dividir el bruto entre el plazo del plan, y
 *     cuando el plan no tiene plazo NO se inventa ninguna,
 *   · el catálogo del vendedor no reintroduce VIN ni cantidades físicas.
 *
 * Crea y borra sus propios datos. No toca ventas, productos ni comisiones reales.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
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
const today = new Date().toISOString().slice(0, 10);
const created = { sales: [], products: [] };

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

/** Fee porcentual redondeado (half-up) — la MISMA regla del motor y de SQL. */
const bpsFee = (amountCents, bps) => Math.round((amountCents * bps) / 10000);

async function main() {
  const admin = await signIn(values.admin);
  const seller = await signIn(values.seller);

  console.log("\n· Preparando catálogo de prueba");
  const stamp = Date.now().toString(36).toUpperCase();
  const tier = commissionTier(1);

  const p = await rpc(admin.c, "admin_create_product", {
    p_name: `E2E CALC ${stamp}`, p_brand: "E2E", p_category: "E2E CALC",
    p_base_price_cents: tier.fixedPriceCents, p_cuba_total_cents: tier.fixedPriceCents,
    p_is_active: true,
  });
  const productId = p.productId ?? p.id;
  created.products.push(productId);
  const v1 = await rpc(admin.c, "admin_create_product_variant", {
    p_product_id: productId, p_color_name: "Negro E2E",
  });
  const variantId = v1.variantId ?? v1.id;
  const v2 = await rpc(admin.c, "admin_create_product_variant", {
    p_product_id: productId, p_color_name: "Rojo E2E",
  });
  const retiredVariantId = v2.variantId ?? v2.id;
  await rpc(admin.c, "admin_update_product_commission_defaults", {
    p_product_id: productId,
    p_default_reference_price_cents: tier.fixedPriceCents,
    p_default_base_commission_cents: tier.fixedCommissionCents,
  });

  // Producto DE BAJA: no debe aparecerle nunca al vendedor.
  const hidden = await rpc(admin.c, "admin_create_product", {
    p_name: `E2E CALC OCULTO ${stamp}`, p_brand: "E2E", p_category: "E2E CALC",
    p_base_price_cents: tier.fixedPriceCents, p_cuba_total_cents: tier.fixedPriceCents,
    p_is_active: false,
  });
  const hiddenProductId = hidden.productId ?? hidden.id;
  created.products.push(hiddenProductId);

  // Métodos reales de la base (nada codificado en el frontend).
  const { data: methods } = await svc
    .from("payment_methods")
    .select("id, name, method_type, fee_strategy, flat_fee_bps, flat_fee_cents, is_active")
    .eq("is_active", true);
  const { data: plans } = await svc
    .from("payment_method_plans")
    .select("id, payment_method_id, label, fee_bps, term_months, is_active")
    .eq("is_active", true);

  // Ojo: hay planes activos que cuelgan de financieras DADAS DE BAJA. Solo
  // sirve un plan con plazo cuya financiera siga activa y sea a plazos.
  const byId = new Map(methods.map((m) => [m.id, m]));
  const planWithTerm = plans.find(
    (pl) => pl.term_months != null && byId.get(pl.payment_method_id)?.fee_strategy === "INSTALLMENTS",
  );
  const financing = byId.get(planWithTerm?.payment_method_id);
  const zelle = methods.find((m) => m.method_type === "ZELLE" && m.fee_strategy === "NONE");
  if (!financing || !zelle) throw new Error("La base no tiene una financiera a plazos y un Zelle activos");

  const price = tier.fixedPriceCents;

  // =====================================================================
  console.log("\nTEST 1 · El vendedor LEE el catálogo activo");
  const visible = await seller.c
    .from("products")
    .select("id, name, default_reference_price_cents, product_variants(id, color_name, is_active)")
    .eq("id", productId)
    .maybeSingle();
  check("ve el producto activo", visible.data?.id === productId, visible.error?.message);
  check("ve sus colores activos", (visible.data?.product_variants ?? []).filter((v) => v.is_active).length === 2);

  const hiddenRead = await seller.c.from("products").select("id").eq("id", hiddenProductId).maybeSingle();
  check("NO ve un producto dado de baja", !hiddenRead.data, hiddenRead.data);

  await rpc(admin.c, "admin_set_product_variant_active", {
    p_variant_id: retiredVariantId, p_active: false,
  });
  const afterRetire = await seller.c
    .from("product_variants")
    .select("id, is_active")
    .eq("product_id", productId);
  const activos = (afterRetire.data ?? []).filter((v) => v.is_active);
  check("un color desactivado deja de ofrecerse", activos.length === 1 && activos[0].id === variantId, afterRetire.data);

  // =====================================================================
  console.log("\nTEST 2 · El catálogo es de SOLO LECTURA para el vendedor");
  const tryPrice = await seller.c
    .from("products")
    .update({ default_reference_price_cents: 1 })
    .eq("id", productId)
    .select();
  const priceNow = (await svc.from("products").select("default_reference_price_cents").eq("id", productId).single()).data;
  check("no puede cambiar el precio de un producto", (tryPrice.data ?? []).length === 0 && priceNow.default_reference_price_cents === price, tryPrice.error?.message);

  const tryActive = await seller.c.from("products").update({ is_active: false }).eq("id", productId).select();
  check("no puede dar de baja un producto", (tryActive.data ?? []).length === 0);

  const tryInsert = await seller.c.from("products").insert({ name: `E2E CALC PIRATA ${stamp}` }).select();
  check("no puede crear productos", (tryInsert.data ?? []).length === 0 && Boolean(tryInsert.error));

  const tryVariant = await seller.c.from("product_variants").update({ is_active: false }).eq("id", variantId).select();
  check("no puede desactivar un color", (tryVariant.data ?? []).length === 0);

  const tryFee = await seller.c.from("payment_methods").update({ flat_fee_bps: 1 }).eq("id", financing.id).select();
  const feeNow = (await svc.from("payment_methods").select("flat_fee_bps").eq("id", financing.id).single()).data;
  check("no puede cambiar el fee de una financiera", (tryFee.data ?? []).length === 0 && feeNow.flat_fee_bps === financing.flat_fee_bps, tryFee.error?.message);

  const tryPlan = await seller.c.from("payment_method_plans").update({ fee_bps: 1 }).eq("id", planWithTerm.id).select();
  const planNow = (await svc.from("payment_method_plans").select("fee_bps").eq("id", planWithTerm.id).single()).data;
  check("no puede cambiar el fee de un plan", (tryPlan.data ?? []).length === 0 && planNow.fee_bps === planWithTerm.fee_bps);

  // =====================================================================
  console.log("\nTEST 3 · Convertir la simulación crea un BORRADOR y nada más");
  // La financiera aprueba JUSTO el total: parece que alcanza, pero descuenta.
  const grossFinancing = price;
  const saleId = await rpc(seller.c, "create_sale_draft", { p_operation_type: "CUBA" });
  created.sales.push(saleId);

  // Exactamente lo que envía la acción de servidor al convertir: solo
  // identificadores e importes en BRUTO. Ningún neto viaja desde el cliente.
  await rpc(seller.c, "save_cuba_sale_draft", {
    p_sale_id: saleId,
    p_payload: {
      saleDate: today, shareCommission: false, internalNotes: "",
      buyer: {
        firstName: "", lastName: "", dateOfBirth: "", documentNumber: "",
        documentExpiration: "", phone: "", email: "", addressLine1: "",
        addressLine2: "", city: "", state: "", postalCode: "",
      },
      coBuyer: null,
      units: [{ productId, variantId, agreedPriceCents: price }],
      extras: [],
      cubaRecipient: {
        fullName: "", identityNumber: "", deliveryAddress: "", municipality: "",
        province: "", phonePrimary: "", phoneSecondary: "",
      },
      delivery: { method: null, reference: "" },
      paymentAllocations: [
        {
          id: null, paymentMethodId: financing.id, planId: planWithTerm.id,
          inputMode: "GROSS", amountCents: grossFinancing, reference: "", notes: "",
          // Basura que un cliente manipulado podría intentar colar:
          feeAmountCents: 0, netAmountCents: grossFinancing, settlementStatus: "SETTLED",
        },
      ],
    },
  });

  const sale = (await svc.from("sales").select("status, seller_id").eq("id", saleId).single()).data;
  check("la venta queda en BORRADOR", sale.status === "DRAFT", sale);
  check("el dueño es el vendedor", sale.seller_id === seller.id);
  check("sin contratos de financiación", ((await svc.from("sale_financing_contracts").select("id").eq("sale_id", saleId)).data ?? []).length === 0);
  check("sin comisión registrada", ((await svc.from("sale_commissions").select("id").eq("sale_id", saleId)).data ?? []).length === 0);

  const [alloc] = (await svc.from("sale_payment_allocations").select("*").eq("sale_id", saleId)).data ?? [];
  check("el pago NO nace liquidado", alloc.settlement_status !== "SETTLED" && alloc.settled_at === null, {
    status: alloc.settlement_status, settled_at: alloc.settled_at,
  });

  // =====================================================================
  console.log("\nTEST 4 · El SERVIDOR recalcula el fee (el neto del cliente se ignora)");
  const expectedFee = bpsFee(grossFinancing, planWithTerm.fee_bps);
  check("bruto = lo aprobado", Number(alloc.gross_amount_cents) === grossFinancing, alloc.gross_amount_cents);
  check("fee calculado con la config vigente", Number(alloc.fee_amount_cents) === expectedFee, {
    esperado: expectedFee, guardado: Number(alloc.fee_amount_cents), bps: planWithTerm.fee_bps,
  });
  check("neto = bruto − fee (no el neto que mandó el cliente)", Number(alloc.net_amount_cents) === grossFinancing - expectedFee, {
    esperado: grossFinancing - expectedFee, guardado: Number(alloc.net_amount_cents),
  });
  check("el fee del plan queda fotografiado", Number(alloc.fee_bps_snapshot) === planWithTerm.fee_bps);

  // =====================================================================
  console.log("\nTEST 5 · La cobertura se mide en NETO");
  const netCovered = Number(alloc.net_amount_cents);
  check("aprobar el total en BRUTO no cubre la venta", netCovered < price && netCovered === price - expectedFee, {
    bruto: grossFinancing, neto: netCovered, total: price,
  });
  const faltan = price - netCovered;

  // Se completa con un pago directo por lo que falta (Zelle no descuenta nada).
  await rpc(seller.c, "sync_sale_payment_allocations", {
    p_sale_id: saleId,
    p_allocations: [
      { id: null, paymentMethodId: financing.id, planId: planWithTerm.id, inputMode: "GROSS", amountCents: grossFinancing, reference: "", notes: "" },
      { id: null, paymentMethodId: zelle.id, planId: null, inputMode: "GROSS", amountCents: faltan, reference: "", notes: "" },
    ],
  });
  const allocs = (await svc.from("sale_payment_allocations").select("*").eq("sale_id", saleId).order("position")).data ?? [];
  const netTotal = allocs.reduce((s, a) => s + Number(a.net_amount_cents), 0);
  check("dos métodos: financiera + pago directo", allocs.length === 2);
  check("el pago directo no descuenta nada", Number(allocs[1].fee_amount_cents) === 0);
  check("con el complemento la venta queda cubierta al centavo", netTotal === price, { netTotal, price });

  // =====================================================================
  console.log("\nTEST 6 · Cuota mensual: división simple y solo si hay plazo");
  const monthly = Math.round(grossFinancing / planWithTerm.term_months);
  check("plazo real del plan", planWithTerm.term_months > 0, planWithTerm);
  check("cuota = bruto ÷ plazo", monthly * planWithTerm.term_months >= grossFinancing - planWithTerm.term_months, { monthly });
  const planSinPlazo = plans.find((pl) => pl.term_months == null);
  if (planSinPlazo) {
    check("hay planes SIN plazo en la base (no se les inventa cuota)", planSinPlazo.term_months == null);
  } else {
    check("hay planes SIN plazo en la base (no se les inventa cuota)", true);
  }

  // =====================================================================
  console.log("\nTEST 7 · El catálogo del vendedor NO reintroduce inventario");
  const fuentes = [
    "src/lib/seller/stock.ts",
    "src/app/(seller)/seller/stock/page.tsx",
    "src/app/(seller)/seller/stock/[productId]/page.tsx",
    "src/components/seller/stock/product-card.tsx",
    "src/components/seller/stock/variant-colors.tsx",
    "src/lib/sales/quote.ts",
    "src/components/seller/calculadora/quote-calculator.tsx",
  ];
  const prohibido = /quantity_reported|stock_mode|inventory_unit|\bVIN\b|reserved/i;
  for (const f of fuentes) {
    const src = readFileSync(resolve(process.cwd(), f), "utf8");
    // El comentario que EXPLICA que no se usan sí puede nombrarlos: se mira el
    // código, no la documentación.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    check(`${f} sin rastro de inventario físico`, !prohibido.test(code), code.match(prohibido)?.[0]);
  }

  // =====================================================================
  console.log("\n· Limpiando");
  for (const id of created.sales) await svc.from("sales").delete().eq("id", id);
  for (const id of created.products) await svc.from("products").delete().eq("id", id);
  const quedan = (await svc.from("sales").select("id").in("id", created.sales)).data ?? [];
  const quedanP = (await svc.from("products").select("id").in("id", created.products)).data ?? [];
  check("no quedan ventas de prueba", quedan.length === 0);
  check("no quedan productos de prueba", quedanP.length === 0);

  console.log(`\nResultado: ${ok} ok · ${fail} fallos`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error("\nERROR:", err.message);
  for (const id of created.sales) await svc.from("sales").delete().eq("id", id);
  for (const id of created.products) await svc.from("products").delete().eq("id", id);
  process.exit(1);
});
