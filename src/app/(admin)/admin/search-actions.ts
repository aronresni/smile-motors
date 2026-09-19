"use server";

import { createClient } from "@/lib/supabase/server";
import { requireZone } from "@/lib/auth/session";

/**
 * Búsqueda global del Admin (Ctrl/Cmd + K): venta, seguimiento, comprador,
 * destinatario, vendedor, producto y financiera. La autorización real vive en la
 * RPC (`is_admin()`); aquí solo se valida la zona como defensa en profundidad.
 */
export interface SearchSaleHit {
  id: string;
  saleNumber: string | null;
  status: string;
  saleTotalCents: number | null;
  saleDate: string | null;
  buyerName: string;
  sellerName: string | null;
  unitsText: string | null;
  /** Financiera(s) que coinciden con la búsqueda, si aplica. */
  provider: string | null;
}
export interface SearchSellerHit {
  id: string;
  fullName: string | null;
  email: string | null;
  accountStatus: string | null;
}
export interface SearchProductHit {
  id: string;
  name: string;
  brand: string | null;
  isActive: boolean;
}
export interface GlobalSearchResult {
  ok: boolean;
  sales: SearchSaleHit[];
  sellers: SearchSellerHit[];
  products: SearchProductHit[];
}

const EMPTY: GlobalSearchResult = { ok: true, sales: [], sellers: [], products: [] };

export async function adminGlobalSearch(query: string): Promise<GlobalSearchResult> {
  await requireZone("admin");
  const q = query.trim().slice(0, 80);
  if (q.length < 2) return EMPTY;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_global_search", { p_query: q, p_limit: 6 });
  if (error || !data) return { ...EMPTY, ok: false };
  const res = data as unknown as Partial<GlobalSearchResult> & { ok?: boolean };
  if (!res.ok) return { ...EMPTY, ok: false };
  return {
    ok: true,
    sales: res.sales ?? [],
    sellers: res.sellers ?? [],
    products: res.products ?? [],
  };
}
