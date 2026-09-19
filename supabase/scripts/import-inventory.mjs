/**
 * Importa el catálogo/inventario del sistema anterior a las tablas relacionales
 * nuevas. IDEMPOTENTE: reconcilia por `legacy_id` (productos), `(product_id,
 * color_normalized)` (variantes), `(product_id, legacy_path)` (imágenes) y `vin`
 * (unidades físicas). Ejecutarlo dos veces NO duplica nada.
 *
 * NO inventa VINs. NO borra información del origen. NO reescribe `quantity`
 * a partir del conteo de VINs. Solo materializa unidades físicas para VIN NO
 * vacíos.
 *
 * Uso:
 *   node --env-file=.env.local supabase/scripts/import-inventory.mjs [ruta.json]
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
  process.argv[2] ?? path.resolve("supabase/seed-data/inventory-legacy.json");
const rows = JSON.parse(fs.readFileSync(SRC, "utf8"));
const products = rows.map((r) => r.data ?? r);

/* --------------------------- helpers ---------------------------- */
const toCents = (v) =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) : null;
const nn = (s) => {
  const t = (s ?? "").toString().trim();
  return t === "" ? null : t;
};
const norm = (s) => (s ?? "").toString().trim().toLowerCase();
/** Legacy VIN status -> nuevo estado. `sold_out` => UNAVAILABLE (no "SOLD":
 *  no hay una venta concreta asociada; solo sabemos que no está disponible). */
const STATUS_MAP = { available: "AVAILABLE", sold_out: "UNAVAILABLE" };

/* ----------------- detección de VIN duplicados ----------------- */
const vinFirstSeen = new Map();
const duplicateVins = [];
for (const p of products) {
  for (const c of p.stockByColor ?? []) {
    for (const v of c.vins ?? []) {
      const vin = (v.vin ?? "").trim();
      if (!vin) continue;
      const where = `${p.id} · ${c.color}`;
      if (vinFirstSeen.has(vin)) {
        duplicateVins.push({ vin, first: vinFirstSeen.get(vin), duplicate: where });
      } else {
        vinFirstSeen.set(vin, where);
      }
    }
  }
}

/* ------------------------- importación ------------------------- */
const productReport = [];
const reconciliation = [];
const warnings = [];

for (const p of products) {
  const productRow = {
    legacy_id: p.id,
    name: p.name,
    brand: nn(p.brand),
    category: nn(p.category),
    displacement: nn(p.displacement),
    power: nn(p.power),
    engine: nn(p.engine),
    weight: nn(p.weight),
    status: nn(p.status),
    is_active: p.isActive !== false,
    stock_mode: nn(p.stockMode),
    base_price_cents: toCents(p.total),
    shipping_cents: toCents(p.shipping),
    cuba_total_cents: toCents(p.totalHabana),
    legacy_commission_cents: toCents(p.commission),
    legacy_timestamp: typeof p.timestamp === "number" ? p.timestamp : null,
    metadata:
      p.onDemandTracksQuantity !== undefined
        ? { onDemandTracksQuantity: p.onDemandTracksQuantity }
        : {},
  };

  const { data: prod, error: pErr } = await admin
    .from("products")
    .upsert(productRow, { onConflict: "legacy_id" })
    .select("id, legacy_id")
    .single();
  if (pErr) throw new Error(`products ${p.id}: ${pErr.message}`);
  const productId = prod.id;

  // imágenes (rutas legadas; storage_path queda null)
  const imageRows = (p.images ?? []).map((legacyPath, i) => ({
    product_id: productId,
    legacy_path: legacyPath,
    storage_path: null,
    position: i,
  }));
  if (imageRows.length) {
    const { error } = await admin
      .from("product_images")
      .upsert(imageRows, { onConflict: "product_id,legacy_path" });
    if (error) throw new Error(`product_images ${p.id}: ${error.message}`);
  }

  let variantCount = 0;
  let reportedQtyTotal = 0;
  let vinCount = 0;

  for (const c of p.stockByColor ?? []) {
    const colorName = (c.color ?? "").toString().trim() || "(sin color)";
    const qty = Number.isInteger(c.quantity) ? c.quantity : 0;

    const { data: variant, error: vErr } = await admin
      .from("product_variants")
      .upsert(
        {
          product_id: productId,
          color_name: colorName,
          color_normalized: norm(colorName),
          quantity_reported: qty,
        },
        { onConflict: "product_id,color_normalized" },
      )
      .select("id")
      .single();
    if (vErr) throw new Error(`product_variants ${p.id}/${colorName}: ${vErr.message}`);

    variantCount += 1;
    reportedQtyTotal += qty;

    const nonEmptyVins = (c.vins ?? []).filter((v) => (v.vin ?? "").trim() !== "");
    let availableVins = 0;
    let soldOrUnavailableVins = 0;

    for (const v of nonEmptyVins) {
      const vin = v.vin.trim();
      const status = STATUS_MAP[v.status] ?? "UNAVAILABLE";
      if (status === "AVAILABLE") availableVins += 1;
      else soldOrUnavailableVins += 1;

      const { data: existing } = await admin
        .from("inventory_units")
        .select("id")
        .eq("vin", vin)
        .maybeSingle();

      if (existing) {
        await admin
          .from("inventory_units")
          .update({
            product_id: productId,
            variant_id: variant.id,
            status,
            legacy_status: nn(v.status),
            note: nn(v.note),
          })
          .eq("id", existing.id);
      } else {
        const { error } = await admin.from("inventory_units").insert({
          product_id: productId,
          variant_id: variant.id,
          vin,
          status,
          legacy_status: nn(v.status),
          note: nn(v.note),
        });
        if (error) {
          warnings.push(
            `VIN no insertado (${p.name} · ${colorName} · ${vin}): ${error.message}`,
          );
        }
      }
    }

    vinCount += nonEmptyVins.length;

    const difference = qty - nonEmptyVins.length;
    reconciliation.push({
      product: p.name,
      color: colorName,
      quantity_reported: qty,
      non_empty_vins: nonEmptyVins.length,
      available_vins: availableVins,
      sold_or_unavailable_vins: soldOrUnavailableVins,
      difference,
    });

    if (difference !== 0) {
      warnings.push(
        `${p.name} · ${colorName}: quantity_reported=${qty} vs VINs=${nonEmptyVins.length} (dif ${difference > 0 ? "+" : ""}${difference})`,
      );
    }
    if (qty > 0 && nonEmptyVins.length === 0 && nn(p.stockMode) !== "on_demand") {
      warnings.push(
        `${p.name} · ${colorName}: cantidad ${qty} sin ningún VIN y NO es on_demand`,
      );
    }
    if (qty === 0 && nonEmptyVins.length > 0) {
      warnings.push(
        `${p.name} · ${colorName}: cantidad 0 pero ${nonEmptyVins.length} VIN(s) presentes`,
      );
    }
  }

  const { data: full } = await admin
    .from("products")
    .select("base_price_cents, cuba_total_cents, legacy_commission_cents")
    .eq("id", productId)
    .single();

  productReport.push({
    legacy_id: p.id,
    product_uuid: productId,
    name: p.name,
    brand: nn(p.brand),
    category: nn(p.category),
    base_price_cents: full.base_price_cents,
    cuba_total_cents: full.cuba_total_cents,
    legacy_commission_cents: full.legacy_commission_cents,
    variants: variantCount,
    reported_quantity_total: reportedQtyTotal,
    vin_records: vinCount,
  });
}

/* --------------------------- salida --------------------------- */
console.log(`\n=== IMPORTACIÓN DE INVENTARIO ===`);
console.log(`Fuente: ${SRC}`);
console.log(`TOTAL DE PRODUCTOS IMPORTADOS: ${productReport.length}\n`);
console.table(productReport);

console.log(`\n=== RECONCILIACIÓN cantidad vs VIN (por variante) ===`);
console.table(reconciliation);

console.log(`\n=== VIN DUPLICADOS EN EL ORIGEN ===`);
if (duplicateVins.length === 0) console.log("Ninguno.");
else console.table(duplicateVins);

console.log(`\n=== ADVERTENCIAS (${warnings.length}) ===`);
for (const w of warnings) console.log(" - " + w);

const totals = {
  products: productReport.length,
  variants: reconciliation.length,
  reported_quantity_total: reconciliation.reduce((a, r) => a + r.quantity_reported, 0),
  vin_records: reconciliation.reduce((a, r) => a + r.non_empty_vins, 0),
  available_vin_records: reconciliation.reduce((a, r) => a + r.available_vins, 0),
};
console.log(`\n=== TOTALES ===`);
console.log(JSON.stringify(totals, null, 2));
