import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Vendedores — `admin_seller_list`/`admin_seller_detail` (RPC, verifican
 * `is_admin()` server-side; la RLS de `profiles` también lo permite). Todo
 * calculado/paginado en la base — nunca se llama a la API de administración
 * de Supabase Auth por cada fila de una lista (ver `sellers-actions.ts` para
 * dónde SÍ hace falta, puntualmente, para invitar/reenviar).
 */
export type SellerAccountStatus = "INVITED" | "ACTIVE" | "SUSPENDED" | "DISABLED";

/** Opciones livianas {id,nombre} para un <select> de filtro (Actividad,
 * Alertas) — reusa `admin_seller_list` con un límite alto en vez de crear
 * una RPC nueva solo para poblar un dropdown. */
export interface SellerFilterOption {
  id: string;
  name: string;
}

export async function getSellerFilterOptions(): Promise<SellerFilterOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_seller_list", {
    p_search: undefined, p_status: "ALL", p_limit: 200, p_offset: 0,
  });
  if (error || !data) return [];
  const res = data as unknown as { ok: boolean; items?: AdminSellerListItem[] };
  if (!res.ok) return [];
  return (res.items ?? [])
    .map((s) => ({ id: s.sellerId, name: s.fullName ?? s.email ?? "Sin nombre" }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface AdminSellerListItem {
  sellerId: string;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  accountStatus: SellerAccountStatus;
  createdAt: string;
  invitedAt: string | null;
  suspendedAt: string | null;
  suspensionReason: string | null;
  pendingCount: number;
  soldCount: number;
  paidCount: number;
  lastActivityAt: string | null;
}

export interface AdminSellerListResult {
  items: AdminSellerListItem[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

const SELLERS_PAGE_SIZE = 20;

export async function getAdminSellerList(
  search: string,
  status: "ALL" | SellerAccountStatus,
  page: number,
): Promise<AdminSellerListResult> {
  const supabase = await createClient();
  const offset = (Math.max(1, page) - 1) * SELLERS_PAGE_SIZE;
  const { data, error } = await supabase.rpc("admin_seller_list", {
    p_search: search || undefined,
    p_status: status,
    p_limit: SELLERS_PAGE_SIZE,
    p_offset: offset,
  });

  const empty: AdminSellerListResult = { items: [], page, pageSize: SELLERS_PAGE_SIZE, totalCount: 0, totalPages: 1 };
  if (error || !data) return empty;
  const res = data as unknown as { ok: boolean; items?: AdminSellerListItem[]; page?: number; pageSize?: number; totalCount?: number };
  if (!res.ok) return empty;

  const pageSize = res.pageSize || SELLERS_PAGE_SIZE;
  const totalCount = res.totalCount ?? 0;
  return {
    items: res.items ?? [],
    page: res.page || page,
    pageSize,
    totalCount,
    totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
  };
}

export interface AdminSellerDetailProfile {
  sellerId: string;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  accountStatus: SellerAccountStatus;
  createdAt: string;
  invitedAt: string | null;
  invitedByName: string | null;
  suspendedAt: string | null;
  suspendedByName: string | null;
  suspensionReason: string | null;
  reactivatedAt: string | null;
}
export interface AdminSellerInvitation {
  id: string;
  email: string;
  status: "PENDING" | "ACCEPTED" | "EXPIRED" | "CANCELLED";
  invitedAt: string;
  acceptedAt: string | null;
}
export interface AdminSellerCommercialSummary {
  pendingCount: number;
  soldCount: number;
  paidCount: number;
  unitsSold: number;
  revenueCents: number;
}
export interface AdminSellerRecentSale {
  saleId: string;
  saleNumber: string | null;
  status: string;
  saleDate: string;
  saleTotalCents: number;
  buyerName: string | null;
}
export interface AdminSellerEvent {
  eventType: string;
  actorName: string | null;
  reason: string | null;
  createdAt: string;
}
export interface AdminSellerDetail {
  profile: AdminSellerDetailProfile;
  invitation: AdminSellerInvitation | null;
  commercial: AdminSellerCommercialSummary;
  recentSales: AdminSellerRecentSale[];
  recentEvents: AdminSellerEvent[];
}

export async function getAdminSellerDetail(sellerId: string): Promise<AdminSellerDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_seller_detail", { p_seller_id: sellerId });
  if (error || !data) return null;
  const res = data as unknown as { ok: boolean } & Partial<AdminSellerDetail>;
  if (!res.ok || !res.profile) return null;
  return {
    profile: res.profile,
    invitation: res.invitation ?? null,
    commercial: res.commercial ?? { pendingCount: 0, soldCount: 0, paidCount: 0, unitsSold: 0, revenueCents: 0 },
    recentSales: res.recentSales ?? [],
    recentEvents: res.recentEvents ?? [],
  };
}
