"use client";

/**
 * Servicio de catálogo respaldado por Supabase (tabla `products` + variantes).
 * Se consulta con límites; no se descarga todo el catálogo al navegador.
 */
import { createClient } from "@/lib/supabase/client";

export interface CatalogVariant {
  id: string;
  label: string; // color / acabado (valor de visualización original)
}

export interface CatalogModel {
  id: string;
  name: string;
  brand: string;
  category: string;
  displacement: string;
  /** Legado `total`. */
  basePriceCents: number;
  /** Legado `totalHabana`. */
  cubaTotalCents: number;
  /**
   * Referencia para "PRECIO DE LISTA" en una venta CUBA.
   *
   * DECISIÓN PROVISIONAL: se usa `cubaTotalCents` (totalHabana) porque es el
   * precio que se cotiza para entrega en Cuba y porque hay productos (IZUKI
   * CHALLENGER) con `total` = 0 y `totalHabana` > 0. Es solo informativo: el
   * precio de venta se completa con `fixedPriceCents` (precio fijo de venta).
   */
  listPriceCents: number;
  /**
   * PRECIO FIJO DE VENTA (mínimo oficial) y COMISIÓN FIJA, configurados por un
   * administrador en la ficha del producto. `null` = sin configurar: la venta
   * no puede enviarse ni marcarse VENDIDA.
   */
  fixedPriceCents: number | null;
  fixedCommissionCents: number | null;
  variants: CatalogVariant[];
}

const SELECT =
  "id, name, brand, category, displacement, base_price_cents, cuba_total_cents, default_reference_price_cents, default_base_commission_cents, product_variants(id, color_name, is_active)";

interface ProductRow {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  displacement: string | null;
  base_price_cents: number | null;
  cuba_total_cents: number | null;
  default_reference_price_cents: number | null;
  default_base_commission_cents: number | null;
  product_variants: { id: string; color_name: string; is_active: boolean }[] | null;
}

function toModel(row: ProductRow): CatalogModel {
  const base = row.base_price_cents ?? 0;
  const cuba = row.cuba_total_cents ?? 0;
  return {
    id: row.id,
    name: row.name,
    brand: row.brand ?? "",
    category: row.category ?? "",
    displacement: row.displacement ?? "",
    basePriceCents: base,
    cubaTotalCents: cuba,
    listPriceCents: cuba || base,
    fixedPriceCents: row.default_reference_price_cents,
    fixedCommissionCents: row.default_base_commission_cents,
    // Una variante desactivada por Admin ya no debe ofrecerse en ventas
    // nuevas (server también lo exige en `save_cuba_sale_draft`).
    variants: (row.product_variants ?? [])
      .filter((v) => v.is_active)
      .map((v) => ({
        id: v.id,
        label: v.color_name,
      })),
  };
}

export async function searchCatalog(query: string): Promise<CatalogModel[]> {
  const supabase = createClient();
  let builder = supabase
    .from("products")
    .select(SELECT)
    .eq("is_active", true)
    .order("name")
    .limit(20);

  const term = query.trim().replace(/[%,()]/g, " ").trim();
  if (term) {
    const like = `%${term}%`;
    builder = builder.or(
      `name.ilike.${like},brand.ilike.${like},category.ilike.${like},displacement.ilike.${like}`,
    );
  }

  const { data, error } = await builder;
  if (error || !data) return [];
  return (data as ProductRow[]).map(toModel);
}

export async function getCatalogModel(id: string): Promise<CatalogModel | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("products")
    .select(SELECT)
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data) return null;
  return toModel(data as ProductRow);
}
