import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Centro de Aprobaciones — capa de datos de Admin. Todo pasa por RPC
 * `SECURITY DEFINER` de solo lectura (`admin_approvals_*`/`admin_*_inbox`/
 * `admin_edit_request*`), cada una re-verifica `is_admin()` server-side.
 * Ninguna de estas descarga tablas completas al navegador — cada una ya
 * pagina/filtra en el servidor.
 */
export interface ApprovalsCounts {
  totalPending: number;
  edicionesSolicitadas: number;
  contratosRequierenAccion: number;
  pendientesACobrar: number;
  listasParaPagar: number;
}

const EMPTY_COUNTS: ApprovalsCounts = {
  totalPending: 0,
  edicionesSolicitadas: 0,
  contratosRequierenAccion: 0,
  pendientesACobrar: 0,
  listasParaPagar: 0,
};

export async function getApprovalsCounts(): Promise<ApprovalsCounts> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_approvals_counts");
  if (error || !data) return EMPTY_COUNTS;
  const res = data as unknown as { ok: boolean } & Partial<ApprovalsCounts>;
  if (!res.ok) return EMPTY_COUNTS;
  return {
    totalPending: res.totalPending ?? 0,
    edicionesSolicitadas: res.edicionesSolicitadas ?? 0,
    contratosRequierenAccion: res.contratosRequierenAccion ?? 0,
    pendientesACobrar: res.pendientesACobrar ?? 0,
    listasParaPagar: res.listasParaPagar ?? 0,
  };
}

export interface TodoItem {
  type: "EDICION" | "CONTRATO" | "COBRO" | "LISTA_PARA_PAGAR";
  createdAt: string;
  title: string;
  subtitle: string;
  sellerId: string;
  sellerName: string;
  saleId: string;
  saleNumber: string | null;
  entityId: string;
  status: string;
  amountCents: number | null;
  actionUrl: string;
}

export async function getApprovalsTodo(limit = 30, offset = 0): Promise<{ items: TodoItem[]; total: number }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_approvals_todo", { p_limit: limit, p_offset: offset });
  if (error || !data) return { items: [], total: 0 };
  const res = data as unknown as { ok: boolean; items?: TodoItem[]; total?: number };
  if (!res.ok) return { items: [], total: 0 };
  return { items: res.items ?? [], total: res.total ?? 0 };
}

export interface EditRequestListItem {
  requestId: string;
  saleId: string;
  saleNumber: string | null;
  saleStatus: string;
  sellerName: string;
  buyerName: string;
  changeCount: number;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  createdAt: string;
  reviewedAt: string | null;
  reviewNote: string | null;
}

export async function getEditRequestsList(
  search: string,
  status: "ALL" | "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED",
  limit = 30,
  offset = 0,
): Promise<{ items: EditRequestListItem[]; total: number }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_edit_requests_list", {
    p_search: search || undefined,
    p_status: status,
    p_limit: limit,
    p_offset: offset,
  });
  if (error || !data) return { items: [], total: 0 };
  const res = data as unknown as { ok: boolean; items?: EditRequestListItem[]; total?: number };
  if (!res.ok) return { items: [], total: 0 };
  return { items: res.items ?? [], total: res.total ?? 0 };
}

export interface EditRequestChange {
  path: string;
  oldValue: string | null;
  newValue: string | null;
  stillMatchesCurrent: boolean;
}
export interface EditRequestDetail {
  requestId: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  reason: string;
  createdAt: string;
  reviewedAt: string | null;
  reviewedByName: string | null;
  reviewNote: string | null;
  saleStatusAtRequest: string;
  sale: { id: string; saleNumber: string | null; status: string; sellerId: string; sellerName: string; buyerName: string };
  changes: EditRequestChange[];
}

export async function getEditRequestDetail(requestId: string): Promise<EditRequestDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_edit_request_detail", { p_request_id: requestId });
  if (error || !data) return null;
  const res = data as unknown as { ok: boolean } & Partial<EditRequestDetail>;
  if (!res.ok || !res.sale) return null;
  return {
    requestId: res.requestId!,
    status: res.status!,
    reason: res.reason!,
    createdAt: res.createdAt!,
    reviewedAt: res.reviewedAt ?? null,
    reviewedByName: res.reviewedByName ?? null,
    reviewNote: res.reviewNote ?? null,
    saleStatusAtRequest: res.saleStatusAtRequest!,
    sale: res.sale,
    changes: res.changes ?? [],
  };
}

export interface ContractInboxItem {
  allocationId: string;
  contractId: string | null;
  saleId: string;
  saleNumber: string | null;
  sellerName: string;
  buyerName: string;
  providerName: string;
  planLabel: string | null;
  grossCents: number;
  netCents: number;
  contractStatus: "NOT_SENT" | "SENT" | "SIGNED";
  lastUpdate: string;
}

export async function getContractsInbox(
  status: "ALL" | "NOT_SENT" | "SENT" | "SIGNED",
  sellerId: string | null,
  search: string,
  limit = 30,
  offset = 0,
): Promise<{ items: ContractInboxItem[]; total: number }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_contracts_inbox", {
    p_status: status,
    p_seller_id: sellerId || undefined,
    p_search: search || undefined,
    p_limit: limit,
    p_offset: offset,
  });
  if (error || !data) return { items: [], total: 0 };
  const res = data as unknown as { ok: boolean; items?: ContractInboxItem[]; total?: number };
  if (!res.ok) return { items: [], total: 0 };
  return { items: res.items ?? [], total: res.total ?? 0 };
}

export interface CollectionInboxItem {
  saleId: string;
  saleNumber: string | null;
  sellerName: string;
  buyerName: string;
  soldAt: string | null;
  saleTotalCents: number;
  collectedCents: number;
  outstandingCents: number;
}

export async function getCollectionsInbox(
  sellerId: string | null,
  search: string,
  limit = 30,
  offset = 0,
): Promise<{ items: CollectionInboxItem[]; total: number }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_collections_inbox", {
    p_seller_id: sellerId || undefined,
    p_search: search || undefined,
    p_limit: limit,
    p_offset: offset,
  });
  if (error || !data) return { items: [], total: 0 };
  const res = data as unknown as { ok: boolean; items?: CollectionInboxItem[]; total?: number };
  if (!res.ok) return { items: [], total: 0 };
  return { items: res.items ?? [], total: res.total ?? 0 };
}

export interface ReadyToPayItem {
  saleId: string;
  saleNumber: string | null;
  sellerName: string;
  buyerName: string;
  soldAt: string | null;
  saleTotalCents: number;
  collectedCents: number;
}

export async function getReadyToPayInbox(
  sellerId: string | null,
  search: string,
  limit = 30,
  offset = 0,
): Promise<{ items: ReadyToPayItem[]; total: number }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_ready_to_pay_inbox", {
    p_seller_id: sellerId || undefined,
    p_search: search || undefined,
    p_limit: limit,
    p_offset: offset,
  });
  if (error || !data) return { items: [], total: 0 };
  const res = data as unknown as { ok: boolean; items?: ReadyToPayItem[]; total?: number };
  if (!res.ok) return { items: [], total: 0 };
  return { items: res.items ?? [], total: res.total ?? 0 };
}
