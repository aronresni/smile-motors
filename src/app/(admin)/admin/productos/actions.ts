"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireZone } from "@/lib/auth/session";
import { ROUTES } from "@/lib/constants";

/**
 * Acciones de administración del catálogo de productos. TODAS pasan por RPC
 * `SECURITY DEFINER` que vuelven a exigir `is_admin()` server-side — mismo
 * patrón que Financieras/Vendedores. `requireZone("admin")` es la primera
 * barrera; la RPC es la segunda y definitiva.
 *
 * Tras cualquier mutación se revalida el listado/ficha de Admin y la ruta de
 * Vendedor de "Nueva venta" (el selector de productos es 100% database-driven
 * vía `searchCatalog()`/`getCatalogModel()`), para que nunca quede una
 * opción de catálogo obsoleta.
 */
export interface RpcResult {
  ok: boolean;
  code?: string;
  [key: string]: unknown;
}

function revalidateProducts(productId?: string) {
  revalidatePath(ROUTES.adminProductos);
  if (productId) revalidatePath(`${ROUTES.adminProductos}/${productId}`);
  revalidatePath(ROUTES.sellerVentaNuevaCuba);
  revalidatePath(ROUTES.sellerVentaNuevaUsa);
  revalidatePath(ROUTES.sellerVentas);
}

export interface CreateProductInput {
  name: string;
  brand?: string;
  category?: string;
  displacement?: string;
  power?: string;
  engine?: string;
  weight?: string;
  isActive: boolean;
  basePriceCents?: number;
  shippingCents?: number;
  cubaTotalCents?: number;
  legacyId?: string;
}

export async function createProduct(input: CreateProductInput): Promise<RpcResult> {
  await requireZone("admin");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_create_product", {
    p_name: input.name,
    p_brand: input.brand || undefined,
    p_category: input.category || undefined,
    p_displacement: input.displacement || undefined,
    p_power: input.power || undefined,
    p_engine: input.engine || undefined,
    p_weight: input.weight || undefined,
    p_is_active: input.isActive,
    p_base_price_cents: input.basePriceCents,
    p_shipping_cents: input.shippingCents,
    p_cuba_total_cents: input.cubaTotalCents,
    p_legacy_id: input.legacyId || undefined,
  });
  if (error || !data) return { ok: false, code: "UNEXPECTED" };
  revalidateProducts();
  return data as RpcResult;
}

export interface UpdateProductInput {
  productId: string;
  name: string;
  brand?: string;
  category?: string;
  displacement?: string;
  power?: string;
  engine?: string;
  weight?: string;
  basePriceCents?: number;
  shippingCents?: number;
  cubaTotalCents?: number;
}

export async function updateProduct(input: UpdateProductInput): Promise<RpcResult> {
  await requireZone("admin");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_update_product", {
    p_product_id: input.productId,
    p_name: input.name,
    p_brand: input.brand || undefined,
    p_category: input.category || undefined,
    p_displacement: input.displacement || undefined,
    p_power: input.power || undefined,
    p_engine: input.engine || undefined,
    p_weight: input.weight || undefined,
    p_base_price_cents: input.basePriceCents,
    p_shipping_cents: input.shippingCents,
    p_cuba_total_cents: input.cubaTotalCents,
  });
  if (error || !data) return { ok: false, code: "UNEXPECTED" };
  revalidateProducts(input.productId);
  return data as RpcResult;
}

export async function setProductActive(productId: string, active: boolean): Promise<RpcResult> {
  await requireZone("admin");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_set_product_active", {
    p_product_id: productId,
    p_active: active,
  });
  if (error || !data) return { ok: false, code: "UNEXPECTED" };
  revalidateProducts(productId);
  return data as RpcResult;
}

export async function duplicateProduct(productId: string, includeVariants: boolean): Promise<RpcResult> {
  await requireZone("admin");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_duplicate_product", {
    p_product_id: productId,
    p_include_variants: includeVariants,
  });
  if (error || !data) return { ok: false, code: "UNEXPECTED" };
  revalidateProducts();
  return data as RpcResult;
}

export interface CreateVariantInput {
  productId: string;
  colorName: string;
}

export async function createVariant(input: CreateVariantInput): Promise<RpcResult> {
  await requireZone("admin");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_create_product_variant", {
    p_product_id: input.productId,
    p_color_name: input.colorName,
  });
  if (error || !data) return { ok: false, code: "UNEXPECTED" };
  revalidateProducts(input.productId);
  return data as RpcResult;
}

export interface UpdateVariantInput {
  variantId: string;
  productId: string;
  colorName: string;
}

export async function updateVariant(input: UpdateVariantInput): Promise<RpcResult> {
  await requireZone("admin");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_update_product_variant", {
    p_variant_id: input.variantId,
    p_color_name: input.colorName,
  });
  if (error || !data) return { ok: false, code: "UNEXPECTED" };
  revalidateProducts(input.productId);
  return data as RpcResult;
}

export async function setVariantActive(variantId: string, productId: string, active: boolean): Promise<RpcResult> {
  await requireZone("admin");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_set_product_variant_active", {
    p_variant_id: variantId,
    p_active: active,
  });
  if (error || !data) return { ok: false, code: "UNEXPECTED" };
  revalidateProducts(productId);
  return data as RpcResult;
}

export async function addProductImage(productId: string, storagePath: string): Promise<RpcResult> {
  await requireZone("admin");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_add_product_image", {
    p_product_id: productId,
    p_storage_path: storagePath,
  });
  if (error || !data) return { ok: false, code: "UNEXPECTED" };
  revalidateProducts(productId);
  return data as RpcResult;
}

/** Quita la fila de catálogo (RPC) y devuelve la ruta de Storage para que el
 * cliente borre el objeto con su propia sesión admin — Storage no es
 * accesible desde SQL. */
export async function removeProductImage(imageId: string, productId: string): Promise<RpcResult> {
  await requireZone("admin");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_remove_product_image", { p_image_id: imageId });
  if (error || !data) return { ok: false, code: "UNEXPECTED" };
  revalidateProducts(productId);
  return data as RpcResult;
}

export async function setPrimaryProductImage(imageId: string, productId: string): Promise<RpcResult> {
  await requireZone("admin");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_set_primary_product_image", { p_image_id: imageId });
  if (error || !data) return { ok: false, code: "UNEXPECTED" };
  revalidateProducts(productId);
  return data as RpcResult;
}

export async function reorderProductImages(productId: string, orderedImageIds: string[]): Promise<RpcResult> {
  await requireZone("admin");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_reorder_product_images", {
    p_product_id: productId,
    p_ordered_image_ids: orderedImageIds,
  });
  if (error || !data) return { ok: false, code: "UNEXPECTED" };
  revalidateProducts(productId);
  return data as RpcResult;
}
