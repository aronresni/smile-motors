import "server-only";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { isPricingConfigured } from "@/lib/commission";
import { productImagePublicUrl } from "@/lib/admin/product-image-url";
import type { StockListQuery } from "@/lib/seller/stock-params";

/**
 * CATÁLOGO DEL VENDEDOR ("Stock").
 *
 * OJO CON EL NOMBRE: en la barra de navegación se llama "Stock" porque es la
 * palabra que usan los vendedores, pero esto NO es inventario físico. Desde la
 * migración `20260918120000_remove_vin_stock` la aplicación no gestiona VIN ni
 * cantidades: aquí no se lee `product_variants.quantity_reported` ni
 * `products.stock_mode` (ambos declarados LEGADO/INACTIVO) y no existe ningún
 * concepto de unidades, reservas ni conciliación.
 *
 * Solo lectura: se consulta con la sesión del vendedor, así que la RLS del
 * catálogo (`products_read_active`) es la que decide qué se ve. El vendedor no
 * puede escribir aquí ni por error — no hay ninguna mutación en este módulo.
 */

/** Lo único que determina si el vendedor puede vender un producto hoy. */
export type StockAvailability = "DISPONIBLE" | "NO_DISPONIBLE";

export interface StockVariant {
  id: string;
  label: string;
}

export interface StockProduct {
  id: string;
  name: string;
  brand: string;
  category: string;
  displacement: string;
  /** Precio de venta oficial (mínimo). `null` = el admin no lo configuró. */
  fixedPriceCents: number | null;
  fixedCommissionCents: number | null;
  /** Referencia de cotización para entrega en Cuba (`cuba_total_cents`). */
  cubaPriceCents: number | null;
  /** Referencia de precio en EE. UU. (`base_price_cents`). */
  usaPriceCents: number | null;
  availability: StockAvailability;
  /** Por qué no se puede vender (solo si `NO_DISPONIBLE`). */
  unavailableReason: string | null;
  imageUrl: string | null;
  variants: StockVariant[];
}

export interface StockProductDetail extends StockProduct {
  engine: string | null;
  power: string | null;
  weight: string | null;
  shippingCents: number | null;
  /** Galería completa, en el orden que fijó el administrador. */
  images: string[];
}

export interface SellerCatalogPage {
  products: StockProduct[];
  /** Categorías REALES del catálogo activo (no hay lista codificada). */
  categories: string[];
  brands: string[];
  /** Productos activos totales, sin filtros (para el estado vacío). */
  totalActive: number;
}

/** Tope defensivo: el catálogo es pequeño, pero nunca se descarga "todo". */
const MAX_ROWS = 120;

const SELECT = [
  "id, name, brand, category, displacement, engine, power, weight",
  "base_price_cents, cuba_total_cents, shipping_cents",
  "default_reference_price_cents, default_base_commission_cents",
  "product_variants(id, color_name, is_active)",
  "product_images(storage_path, position)",
].join(", ");

interface ProductRow {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  displacement: string | null;
  engine: string | null;
  power: string | null;
  weight: string | null;
  base_price_cents: number | null;
  cuba_total_cents: number | null;
  shipping_cents: number | null;
  default_reference_price_cents: number | null;
  default_base_commission_cents: number | null;
  product_variants: { id: string; color_name: string; is_active: boolean }[] | null;
  product_images: { storage_path: string | null; position: number }[] | null;
}

/** Imágenes reales (las rutas legadas sin archivo migrado se descartan). */
function imageUrls(row: ProductRow): string[] {
  return (row.product_images ?? [])
    .filter((i): i is { storage_path: string; position: number } => Boolean(i.storage_path))
    .sort((a, b) => a.position - b.position)
    .map((i) => productImagePublicUrl(env.NEXT_PUBLIC_SUPABASE_URL, i.storage_path));
}

function toProduct(row: ProductRow): StockProduct {
  const fixedPriceCents = row.default_reference_price_cents;
  const fixedCommissionCents = row.default_base_commission_cents;
  // Un producto activo SIN precio fijo o sin comisión fija no se puede vender:
  // el formulario de venta lo rechaza (`saleUnitSchema`) y `mark_sale_sold`
  // tampoco lo aceptaría. Se muestra con el motivo, no se esconde.
  const sellable = isPricingConfigured(fixedPriceCents, fixedCommissionCents);
  return {
    id: row.id,
    name: row.name,
    brand: row.brand ?? "",
    category: row.category ?? "",
    displacement: row.displacement ?? "",
    fixedPriceCents,
    fixedCommissionCents,
    cubaPriceCents: row.cuba_total_cents || null,
    usaPriceCents: row.base_price_cents || null,
    availability: sellable ? "DISPONIBLE" : "NO_DISPONIBLE",
    unavailableReason: sellable
      ? null
      : "Sin precio de venta o comisión configurados. Un administrador debe completarlos.",
    imageUrl: imageUrls(row)[0] ?? null,
    variants: (row.product_variants ?? [])
      .filter((v) => v.is_active)
      .map((v) => ({ id: v.id, label: v.color_name }))
      .sort((a, b) => a.label.localeCompare(b.label, "es")),
  };
}

/** Escapa lo que rompería el filtro `or(...)` de PostgREST. */
function sanitizeTerm(raw: string): string {
  return raw.trim().replace(/[%,()]/g, " ").trim().slice(0, 80);
}

export async function getSellerCatalog(query: StockListQuery): Promise<SellerCatalogPage> {
  const supabase = await createClient();

  let builder = supabase
    .from("products")
    .select(SELECT)
    .eq("is_active", true)
    .order("name", { ascending: true })
    .limit(MAX_ROWS);

  if (query.category) builder = builder.eq("category", query.category);
  if (query.brand) builder = builder.ilike("brand", query.brand);

  const term = sanitizeTerm(query.search);
  if (term) {
    const like = `%${term}%`;
    builder = builder.or(
      `name.ilike.${like},brand.ilike.${like},category.ilike.${like},displacement.ilike.${like}`,
    );
  }

  // Facetas: se leen aparte para que no dependan de los filtros aplicados
  // (si no, elegir una categoría haría desaparecer las demás pestañas).
  const [{ data, error }, { data: facets }] = await Promise.all([
    builder,
    supabase.from("products").select("category, brand").eq("is_active", true).limit(500),
  ]);

  const rows = (error ? [] : ((data ?? []) as unknown as ProductRow[])).map(toProduct);

  const categories = new Set<string>();
  const brands = new Map<string, string>();
  for (const f of facets ?? []) {
    if (f.category) categories.add(f.category);
    // Las marcas del legado vienen con mayúsculas inconsistentes
    // ("VITACCI" / "vitacci"): se agrupan por clave normalizada.
    if (f.brand) brands.set(f.brand.trim().toUpperCase(), f.brand.trim().toUpperCase());
  }

  return {
    products: rows,
    categories: [...categories].sort((a, b) => a.localeCompare(b, "es")),
    brands: [...brands.values()].sort((a, b) => a.localeCompare(b, "es")),
    totalActive: facets?.length ?? rows.length,
  };
}

export async function getSellerProduct(productId: string): Promise<StockProductDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select(SELECT)
    .eq("id", productId)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as unknown as ProductRow;
  return {
    ...toProduct(row),
    engine: row.engine,
    power: row.power,
    weight: row.weight,
    shippingCents: row.shipping_cents,
    images: imageUrls(row),
  };
}
