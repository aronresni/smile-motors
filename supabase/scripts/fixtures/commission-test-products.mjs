/**
 * FIXTURE DE PRUEBAS — PRECIO FIJO DE VENTA y COMISIÓN FIJA TEMPORALES.
 *
 * Solo lo usan las pruebas automáticas (integración y Playwright). Cada prueba
 * crea sus PROPIOS productos de prueba ("E2E …"), les aplica estos valores con
 * la misma RPC que usa el panel (`admin_update_product_commission_defaults`)
 * y los elimina al terminar.
 *
 * Nunca se cargan por migración ni por seed, ni se aplican a productos reales:
 * en una instalación real o limpia cada producto queda SIN precio fijo ni
 * comisión fija hasta que un administrador los complete en
 * /admin/productos/[id]. Mientras falte alguno, sus ventas no pueden enviarse
 * ni pasar a VENDIDA y aparece la alerta "Comisión faltante".
 *
 * Columnas: precio fijo = products.default_reference_price_cents ·
 * comisión fija = products.default_base_commission_cents.
 */

/** Rango permitido para los precios fijos de prueba: $3,500 – $5,999. */
export const FIXED_PRICE_RANGE_CENTS = Object.freeze({ min: 350000, max: 599900 });

/** Comisión fija ≈ 10 % del precio fijo (tolerancia ± 1.5 puntos: 8.5 % – 11.5 %). */
export const COMMISSION_RATIO = Object.freeze({ target: 0.1, tolerance: 0.015 });

/**
 * TODO producto de prueba (de cualquier prueba) se llama "E2E …": así se
 * distinguen de los reales y se detectan restos tras una ejecución.
 */
export const TEST_PRODUCT_NAME_PREFIX = "E2E ";

/** Ejemplo obligatorio de la especificación: precio fijo $4,500 · comisión fija $500. */
export const EXAMPLE_PRICING = Object.freeze({ tier: "ejemplo", fixedPriceCents: 450000, fixedCommissionCents: 50000 });

/** Los 8 niveles de prueba (importes simples y redondeados, en centavos). */
export const COMMISSION_TEST_PRODUCTS = Object.freeze(
  [
    { tier: 1, fixedPriceCents: 350000, fixedCommissionCents: 35000 }, // $3,500 → $350
    { tier: 2, fixedPriceCents: 379900, fixedCommissionCents: 40000 }, // $3,799 → $400
    { tier: 3, fixedPriceCents: 399900, fixedCommissionCents: 40000 }, // $3,999 → $400
    { tier: 4, fixedPriceCents: 429900, fixedCommissionCents: 45000 }, // $4,299 → $450
    { tier: 5, fixedPriceCents: 459900, fixedCommissionCents: 45000 }, // $4,599 → $450
    { tier: 6, fixedPriceCents: 489900, fixedCommissionCents: 50000 }, // $4,899 → $500
    { tier: 7, fixedPriceCents: 529900, fixedCommissionCents: 55000 }, // $5,299 → $550
    { tier: 8, fixedPriceCents: 599900, fixedCommissionCents: 60000 }, // $5,999 → $600
  ].map((t) => Object.freeze(t)),
);

/** Nivel de prueba por número (1-8). */
export function commissionTier(tier) {
  const t = COMMISSION_TEST_PRODUCTS.find((x) => x.tier === tier);
  if (!t) throw new Error(`Nivel de comisión de prueba inexistente: ${tier}`);
  return t;
}

/**
 * Misma fórmula que `mark_sale_sold` (solo para calcular lo esperado; el
 * servidor es la fuente de verdad), en centavos enteros:
 *   adicional = venta − precio fijo (nunca < 0) · vendedor = floor(adicional / 2)
 *   tienda = adicional − vendedor · comisión = comisión fija + vendedor.
 * Una venta por debajo del precio fijo NO se permite: devuelve `null`.
 */
export function expectedCommission(salePriceCents, { fixedPriceCents, fixedCommissionCents }) {
  if (salePriceCents < fixedPriceCents) return null;
  const extraCents = salePriceCents - fixedPriceCents;
  const sellerExtraCents = Math.floor(extraCents / 2);
  return {
    extraCents,
    sellerExtraCents,
    storeExtraCents: extraCents - sellerExtraCents,
    finalCommissionCents: fixedCommissionCents + sellerExtraCents,
  };
}

/**
 * Incumplimientos de un conjunto de valores de prueba (vacío = válido): precio
 * fijo dentro de $3,500–$5,999, comisión ≈ 10 % e importes redondeados (precio
 * en dólares enteros, comisión múltiplo de $50).
 */
export function commissionFixtureViolations(tiers = [...COMMISSION_TEST_PRODUCTS, EXAMPLE_PRICING]) {
  const out = [];
  for (const t of tiers) {
    const price = t.fixedPriceCents;
    const commission = t.fixedCommissionCents;
    const label = `nivel ${t.tier ?? "?"}`;
    if (!Number.isInteger(price) || price < FIXED_PRICE_RANGE_CENTS.min || price > FIXED_PRICE_RANGE_CENTS.max) {
      out.push(`${label}: precio fijo ${price} fuera de $3,500–$5,999`);
    }
    if (!Number.isInteger(commission) || !(price > 0) || Math.abs(commission / price - COMMISSION_RATIO.target) > COMMISSION_RATIO.tolerance) {
      out.push(`${label}: comisión fija ${commission} no es ≈ 10 % de ${price}`);
    }
    if (price % 100 !== 0) out.push(`${label}: el precio fijo no es un importe en dólares enteros`);
    if (commission % 5000 !== 0) out.push(`${label}: la comisión fija no es múltiplo de $50`);
  }
  return out;
}

async function rpcOk(client, fn, args) {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  if (data && data.ok === false) throw new Error(`${fn}: ${JSON.stringify(data)}`);
  return data;
}

/** Aplica el precio fijo y la comisión fija a un producto de prueba vía la RPC del panel (solo admin). */
export async function setTestProductPricing(adminClient, productId, { fixedPriceCents, fixedCommissionCents }) {
  return rpcOk(adminClient, "admin_update_product_commission_defaults", {
    p_product_id: productId,
    p_default_reference_price_cents: fixedPriceCents,
    p_default_base_commission_cents: fixedCommissionCents,
  });
}

/**
 * Deja un producto de PRUEBA con un valor sin configurar (el panel ya no
 * permite vaciarlos). Escritura directa con service_role, protegida: solo
 * actúa sobre productos cuyo nombre empieza por "E2E ".
 */
export async function unsetTestProductValue(svc, productId, which) {
  const column = which === "fixedPrice" ? "default_reference_price_cents" : "default_base_commission_cents";
  const { data, error } = await svc
    .from("products")
    .update({ [column]: null })
    .eq("id", productId)
    .ilike("name", `${TEST_PRODUCT_NAME_PREFIX}%`)
    .select("id");
  if (error) throw new Error(`unset ${column}: ${error.message}`);
  if (!data?.length) throw new Error(`unset ${column}: ${productId} no es un producto de prueba`);
}

/**
 * Crea un producto de prueba ACTIVO con una variante (vía las RPC reales de
 * admin). Con `pricing` le aplica el precio fijo y la comisión fija; sin él
 * queda SIN configurar, como un producto nuevo real. Quien lo crea debe
 * borrarlo con `deleteTestProducts`.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} adminClient
 * @param {{ name: string, pricing?: { fixedPriceCents: number, fixedCommissionCents: number } | null }} options
 */
export async function createTestProduct(adminClient, { name, pricing = null }) {
  if (!name.startsWith(TEST_PRODUCT_NAME_PREFIX)) throw new Error(`El nombre debe empezar por "${TEST_PRODUCT_NAME_PREFIX}"`);
  const catalogPrice = pricing ? pricing.fixedPriceCents : FIXED_PRICE_RANGE_CENTS.min;
  const p = await rpcOk(adminClient, "admin_create_product", {
    p_name: name, p_brand: "E2E", p_category: "Moto",
    p_base_price_cents: catalogPrice, p_cuba_total_cents: catalogPrice, p_is_active: true,
  });
  const productId = p.productId;
  const v = await rpcOk(adminClient, "admin_create_product_variant", { p_product_id: productId, p_color_name: "Negro E2E" });
  if (pricing) await setTestProductPricing(adminClient, productId, pricing);
  return { productId, variantId: v.variantId, name, pricing };
}

/** Crea los 8 productos de prueba ("<prefijo> N1" … "N8"), uno por nivel, con sus valores temporales. */
export async function createCommissionTestProducts(adminClient, namePrefix) {
  const out = [];
  for (const t of COMMISSION_TEST_PRODUCTS) {
    out.push(await createTestProduct(adminClient, { name: `${namePrefix} N${t.tier}`, pricing: t }));
  }
  return out;
}

/** Borra productos de prueba (eventos de catálogo, variantes y producto). Devuelve los errores. */
export async function deleteTestProducts(svc, productIds) {
  const errors = [];
  for (const id of productIds) {
    await svc.from("product_catalog_events").delete().eq("product_id", id);
    await svc.from("product_variants").delete().eq("product_id", id);
    const { error } = await svc.from("products").delete().eq("id", id);
    if (error) errors.push(`producto ${id}: ${error.message}`);
  }
  return errors;
}

/**
 * Foto de los productos REALES (todo lo que no es de prueba): id, estado,
 * precio fijo, comisión fija y última modificación. Sirve para comprobar que
 * las pruebas no dejaron ningún valor cargado ni tocaron productos reales.
 */
export async function snapshotRealProducts(svc) {
  const { data, error } = await svc
    .from("products")
    .select("id, name, is_active, default_reference_price_cents, default_base_commission_cents, updated_at")
    .not("name", "ilike", `${TEST_PRODUCT_NAME_PREFIX}%`)
    .order("id");
  if (error) throw new Error(`products: ${error.message}`);
  return data ?? [];
}

/** Productos de prueba ("E2E …") que siguen en la base — al terminar debe ser ninguno. */
export async function leftoverTestProducts(svc) {
  const { data, error } = await svc
    .from("products")
    .select("id, name, default_reference_price_cents, default_base_commission_cents")
    .ilike("name", `${TEST_PRODUCT_NAME_PREFIX}%`);
  if (error) throw new Error(`products: ${error.message}`);
  return data ?? [];
}
