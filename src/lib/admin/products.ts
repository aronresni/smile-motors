import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Catálogo de productos — capa de datos de Admin. Todo pasa por las RPC
 * `admin_product_*`/`admin_create_product`/etc. (`SECURITY DEFINER`,
 * verifican `is_admin()` server-side) — aunque la RLS de `products`/
 * `product_variants`/`product_images` YA permite escritura admin directa
 * (`for all using(is_admin())`), se mantiene el patrón RPC del resto del
 * Admin por auditoría atómica y mensajes de error consistentes.
 */
export interface AdminProductListItem {
  productId: string;
  legacyId: string | null;
  name: string;
  brand: string | null;
  category: string | null;
  isActive: boolean;
  basePriceCents: number | null;
  cubaTotalCents: number | null;
  variantCount: number;
  /** Precio fijo de venta (`defaultReferencePriceCents`) + comisión fija (`defaultBaseCommissionCents`). */
  defaultReferencePriceCents: number | null;
  defaultBaseCommissionCents: number | null;
}

export interface AdminProductListFilters {
  search: string;
  status: "ALL" | "ACTIVE" | "INACTIVE";
  category: string; // "ALL" o un valor real de categoría
}

export interface AdminProductListResult {
  items: AdminProductListItem[];
  categories: string[];
}

export async function getAdminProductList(filters: AdminProductListFilters): Promise<AdminProductListResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_product_list", {
    p_search: filters.search || undefined,
    p_status: filters.status,
    p_category: filters.category,
  });
  if (error || !data) return { items: [], categories: [] };
  const res = data as unknown as { ok: boolean; items?: AdminProductListItem[]; categories?: string[] };
  if (!res.ok) return { items: [], categories: [] };
  return { items: res.items ?? [], categories: res.categories ?? [] };
}

export interface AdminProductFull {
  id: string;
  legacy_id: string | null;
  name: string;
  brand: string | null;
  category: string | null;
  displacement: string | null;
  power: string | null;
  engine: string | null;
  weight: string | null;
  status: string | null;
  is_active: boolean;
  base_price_cents: number | null;
  shipping_cents: number | null;
  cuba_total_cents: number | null;
  legacy_commission_cents: number | null;
  default_reference_price_cents: number | null;
  default_base_commission_cents: number | null;
  created_at: string;
  updated_at: string;
}

export interface AdminProductVariant {
  id: string;
  colorName: string;
  isActive: boolean;
  salesUsingCount: number;
}

export interface AdminProductImage {
  id: string;
  storagePath: string | null;
  legacyPath: string | null;
  position: number;
}

export interface AdminProductPriceHistoryEntry {
  basePriceCents: string | null;
  cubaTotalCents: string | null;
  changedAt: string;
  actorName: string | null;
}

export interface AdminProductEvent {
  eventType: string;
  actorName: string | null;
  variantLabel: string | null;
  changes: Record<string, unknown> | null;
  createdAt: string;
}

export interface AdminProductDetail {
  product: AdminProductFull;
  variants: AdminProductVariant[];
  images: AdminProductImage[];
  salesUsingCount: number;
  priceHistory: AdminProductPriceHistoryEntry[];
  recentEvents: AdminProductEvent[];
}

export async function getAdminProductDetail(productId: string): Promise<AdminProductDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_product_detail", { p_product_id: productId });
  if (error || !data) return null;
  const res = data as unknown as { ok: boolean } & Partial<AdminProductDetail>;
  if (!res.ok || !res.product) return null;
  return {
    product: res.product,
    variants: res.variants ?? [],
    images: res.images ?? [],
    salesUsingCount: res.salesUsingCount ?? 0,
    priceHistory: res.priceHistory ?? [],
    recentEvents: res.recentEvents ?? [],
  };
}
