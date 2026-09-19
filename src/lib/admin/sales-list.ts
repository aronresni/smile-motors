import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  ADMIN_SALES_LIST_PAGE_SIZE,
  resolveAdminSalesListDateRange,
  type AdminSalesListQuery,
} from "@/lib/admin/sales-list-params";

/**
 * Listado de ventas de TODOS los vendedores — `admin_sales_list` (RPC,
 * verifica `is_admin()` server-side; la RLS de `sales` también lo permite).
 * Filtrado/búsqueda/paginación ocurren en la base — el navegador nunca
 * descarga el histórico completo.
 */
export type AdminSaleListStatus = "DRAFT" | "PENDING" | "SOLD" | "PAID" | string;
export type AdminCollectionStatus = "PENDING_COLLECTION" | "READY_TO_PAY" | "PAID" | null;

export interface AdminSaleListUnit {
  productName: string;
  variant: string | null;
  trackingCode: string | null;
}
export interface AdminSaleListFinancing {
  providers: number;
  pendingContract: number;
  sent: number;
  signed: number;
  accredited: number;
}
export interface AdminSaleListFinancingProvider {
  providerName: string;
  status: string;
}

export interface AdminSaleListItem {
  saleId: string;
  saleNumber: string | null;
  status: AdminSaleListStatus;
  operationType: string;
  saleDate: string;
  hasExplicitDate: boolean;
  sellerId: string;
  sellerName: string | null;
  soldAt: string | null;
  paidAt: string | null;
  reviewRequestedAt: string | null;
  settlementStatus: "PENDING_COLLECTION" | "PAID" | null;
  collectionStatus: AdminCollectionStatus;
  closingReviewedAt: string | null;
  buyerName: string | null;
  unitCount: number;
  units: AdminSaleListUnit[];
  saleTotalCents: number;
  collectedCents: number;
  outstandingCents: number;
  financing: AdminSaleListFinancing;
  financingProviders: AdminSaleListFinancingProvider[];
}

export interface AdminSalesListResult {
  items: AdminSaleListItem[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

function emptyResult(query: AdminSalesListQuery): AdminSalesListResult {
  return { items: [], page: query.page, pageSize: ADMIN_SALES_LIST_PAGE_SIZE, totalCount: 0, totalPages: 1 };
}

export async function getAdminSalesList(
  query: AdminSalesListQuery,
): Promise<AdminSalesListResult> {
  const { startDate, endDate } = resolveAdminSalesListDateRange(query);
  const offset = (Math.max(1, query.page) - 1) * ADMIN_SALES_LIST_PAGE_SIZE;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_sales_list", {
    p_search: query.search || undefined,
    p_start_date: startDate ?? undefined,
    p_end_date: endDate ?? undefined,
    p_sale_status: query.saleStatus === "all" ? "ALL" : query.saleStatus.toUpperCase(),
    p_collection_status: query.collection === "all" ? "ALL" : query.collection.toUpperCase(),
    p_seller_id: query.sellerId ?? undefined,
    p_financing_status: query.financing === "all" ? "ALL" : query.financing.toUpperCase(),
    p_limit: ADMIN_SALES_LIST_PAGE_SIZE,
    p_offset: offset,
  });

  if (error || !data) return emptyResult(query);
  const res = data as unknown as { ok: boolean; items?: AdminSaleListItem[]; page?: number; pageSize?: number; totalCount?: number };
  if (!res.ok) return emptyResult(query);

  const pageSize = res.pageSize || ADMIN_SALES_LIST_PAGE_SIZE;
  const totalCount = res.totalCount ?? 0;

  return {
    items: res.items ?? [],
    page: res.page || query.page,
    pageSize,
    totalCount,
    totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
  };
}

export interface AdminSellerOption {
  id: string;
  fullName: string | null;
}

/** Vendedores activos, para el selector de filtro — RLS ya permite a un
 * admin leer todos los `profiles`. */
export async function getActiveSellers(): Promise<AdminSellerOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("role", "seller")
    .eq("is_active", true)
    .order("full_name", { ascending: true });
  if (error || !data) return [];
  return data.map((p) => ({ id: p.id, fullName: p.full_name }));
}
