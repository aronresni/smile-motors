import "server-only";
import { createClient } from "@/lib/supabase/server";
import { emptyCommissionPreview, type CommissionPreview } from "@/lib/sales/commission-preview";
import {
  SALES_LIST_PAGE_SIZE,
  resolveSalesListDateRange,
  type SellerSalesListQuery,
} from "@/lib/seller/sales-list-params";

/**
 * Datos de la lista "Mis ventas" del vendedor.
 *
 * - Todo el filtrado / la búsqueda / la agregación ocurren en la RPC
 *   `seller_sales_list` (SECURITY INVOKER). El navegador nunca descarga todas
 *   las ventas para filtrar en cliente.
 * - Aislamiento: la RPC filtra por `auth.uid()` y la RLS de `sales` vuelve a
 *   restringir. Nunca se pasa un `sellerId` del cliente.
 * - El estado (`SellerSalesListQuery`) proviene de la query string de la URL.
 * - Estado comercial: DRAFT | PENDING | SOLD | PAID | CANCELLED — TODAS las
 *   ventas del vendedor, confirmadas o no. "Volumen vendido" / "Unidades" del
 *   resumen solo cuentan SOLD+PAID.
 * - Comisión de cada venta (`seller_sale_commission_previews`): congelada en
 *   VENDIDA/PAGADA; ESTIMADA (no liquidable) en BORRADOR/PENDIENTE.
 */

export type SaleListStatus = "DRAFT" | "PENDING" | "SOLD" | "PAID" | string;
export type SaleListOperation = "CUBA" | "USA" | "LOCAL" | string;

export interface SellerSaleListUnit {
  productName: string;
  variant: string | null;
  trackingCode: string | null;
}

export interface SellerSaleListFinancing {
  /** Nº de allocations de tipo FINANCING en la venta. */
  providers: number;
  /** De esas, cuántas todavía no tienen contrato (`mark_financing_sent`). */
  pendingContract: number;
  sent: number;
  signed: number;
  accredited: number;
}

export interface SellerSaleListItem {
  saleId: string;
  saleNumber: string | null;
  status: SaleListStatus;
  operationType: SaleListOperation;
  /** Fecha efectiva `yyyy-mm-dd` (sale_date o, en borradores sin fecha, creación). */
  saleDate: string;
  /** `false` cuando la fecha proviene de `created_at` (borrador sin fecha fijada). */
  hasExplicitDate: boolean;
  soldAt: string | null;
  paidAt: string | null;
  reviewRequestedAt: string | null;
  /** Estado de COBRO (separado de `status`): null hasta SOLD/PAID. */
  settlementStatus: "PENDING_COLLECTION" | "PAID" | null;
  /** Derivado EN VIVO (no la foto guardada): PENDING_COLLECTION | READY_TO_PAY | PAID | null. */
  collectionStatus: "PENDING_COLLECTION" | "READY_TO_PAY" | "PAID" | null;
  closingReviewedAt: string | null;
  amountOutstandingCents: number | null;
  buyerName: string | null;
  /** Total de unidades de la venta (la lista `units` viene recortada). */
  unitCount: number;
  /** Hasta 6 unidades para previsualización. */
  units: SellerSaleListUnit[];
  saleTotalCents: number;
  financing: SellerSaleListFinancing;
  /** Comisión mostrada: congelada, estimada, "sin calcular" o "sin comisión". */
  commission: CommissionPreview;
}

export interface SellerSalesListSummary {
  /** Nº de ventas que cumplen el filtro actual (cualquier estado). */
  operations: number;
  draftCount: number;
  pendingCount: number;
  soldCount: number;
  paidCount: number;
  /** Σ `sales.sale_total_cents` de SOLD+PAID del filtro. Enteros, centavos. */
  volumeCents: number;
  /** Nº de filas `sale_units` de las ventas SOLD+PAID del filtro. */
  unitsSold: number;
}

export interface SellerSalesListResult {
  items: SellerSaleListItem[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  summary: SellerSalesListSummary;
}

interface SalesListRpc {
  items: {
    saleId: string;
    saleNumber: string | null;
    status: string;
    operationType: string;
    saleDate: string;
    hasExplicitDate: boolean;
    soldAt: string | null;
    paidAt: string | null;
    reviewRequestedAt: string | null;
    settlementStatus: "PENDING_COLLECTION" | "PAID" | null;
    collectionStatus: "PENDING_COLLECTION" | "READY_TO_PAY" | "PAID" | null;
    closingReviewedAt: string | null;
    amountOutstandingCents: number | null;
    buyerName: string | null;
    unitCount: number;
    units: { productName: string; variant: string | null; trackingCode: string | null }[];
    saleTotalCents: number;
    financing: {
      providers: number;
      pendingContract: number;
      sent: number;
      signed: number;
      accredited: number;
    };
  }[];
  page: number;
  pageSize: number;
  totalCount: number;
  summary: {
    operations: number;
    draftCount: number;
    pendingCount: number;
    soldCount: number;
    paidCount: number;
    volumeCents: number;
    unitsSold: number;
  };
}

const STATUS_TO_DB: Record<SellerSalesListQuery["status"], string> = {
  all: "ALL",
  draft: "DRAFT",
  pending: "PENDING",
  sold: "SOLD",
  paid: "PAID",
  cancelled: "CANCELLED",
};

const OPERATION_TO_DB: Record<SellerSalesListQuery["operation"], string> = {
  all: "ALL",
  cuba: "CUBA",
  usa: "USA",
  local: "LOCAL",
};

const FINANCING_TO_DB: Record<SellerSalesListQuery["financing"], string> = {
  all: "ALL",
  none: "NONE",
  pending_contract: "PENDING_CONTRACT",
  sent: "SENT",
  signed: "SIGNED",
  accredited: "ACCREDITED",
};

const SETTLEMENT_TO_DB: Record<SellerSalesListQuery["settlement"], string> = {
  all: "ALL",
  pending_collection: "PENDING_COLLECTION",
  paid: "PAID",
};

function emptyResult(query: SellerSalesListQuery): SellerSalesListResult {
  return {
    items: [],
    page: query.page,
    pageSize: SALES_LIST_PAGE_SIZE,
    totalCount: 0,
    totalPages: 1,
    summary: {
      operations: 0,
      draftCount: 0,
      pendingCount: 0,
      soldCount: 0,
      paidCount: 0,
      volumeCents: 0,
      unitsSold: 0,
    },
  };
}

export async function getSellerSalesList(
  query: SellerSalesListQuery,
): Promise<SellerSalesListResult> {
  const { startDate, endDate } = resolveSalesListDateRange(query);
  const offset = (Math.max(1, query.page) - 1) * SALES_LIST_PAGE_SIZE;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("seller_sales_list", {
    p_search: query.search || undefined,
    p_start_date: startDate ?? undefined,
    p_end_date: endDate ?? undefined,
    p_status: STATUS_TO_DB[query.status],
    p_operation_type: OPERATION_TO_DB[query.operation],
    p_financing_status: FINANCING_TO_DB[query.financing],
    p_settlement: SETTLEMENT_TO_DB[query.settlement],
    p_limit: SALES_LIST_PAGE_SIZE,
    p_offset: offset,
  });

  if (error || !data) return emptyResult(query);

  const rpc = data as unknown as SalesListRpc;
  const pageSize = rpc.pageSize || SALES_LIST_PAGE_SIZE;
  const totalCount = rpc.totalCount ?? 0;

  // Comisión de las ventas de esta página (la RPC vuelve a exigir dueño o admin).
  const ids = (rpc.items ?? []).map((it) => it.saleId);
  const { data: previewData } = ids.length
    ? await supabase.rpc("seller_sale_commission_previews", { p_sale_ids: ids })
    : { data: null };
  const previews =
    ((previewData as unknown as { ok?: boolean; items?: Record<string, CommissionPreview> } | null)?.items) ?? {};

  return {
    items: (rpc.items ?? []).map((it) => ({
      saleId: it.saleId,
      saleNumber: it.saleNumber ?? null,
      status: it.status,
      operationType: it.operationType,
      saleDate: it.saleDate,
      hasExplicitDate: Boolean(it.hasExplicitDate),
      soldAt: it.soldAt ?? null,
      paidAt: it.paidAt ?? null,
      reviewRequestedAt: it.reviewRequestedAt ?? null,
      settlementStatus: it.settlementStatus ?? null,
      collectionStatus: it.collectionStatus ?? null,
      closingReviewedAt: it.closingReviewedAt ?? null,
      amountOutstandingCents: it.amountOutstandingCents ?? null,
      buyerName: it.buyerName ?? null,
      unitCount: it.unitCount ?? 0,
      units: (it.units ?? []).map((u) => ({
        productName: u.productName ?? "",
        variant: u.variant ?? null,
        trackingCode: u.trackingCode ?? null,
      })),
      saleTotalCents: it.saleTotalCents ?? 0,
      financing: {
        providers: it.financing?.providers ?? 0,
        pendingContract: it.financing?.pendingContract ?? 0,
        sent: it.financing?.sent ?? 0,
        signed: it.financing?.signed ?? 0,
        accredited: it.financing?.accredited ?? 0,
      },
      commission: previews[it.saleId] ?? emptyCommissionPreview(),
    })),
    page: rpc.page || query.page,
    pageSize,
    totalCount,
    totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
    summary: {
      operations: rpc.summary?.operations ?? 0,
      draftCount: rpc.summary?.draftCount ?? 0,
      pendingCount: rpc.summary?.pendingCount ?? 0,
      soldCount: rpc.summary?.soldCount ?? 0,
      paidCount: rpc.summary?.paidCount ?? 0,
      volumeCents: rpc.summary?.volumeCents ?? 0,
      unitsSold: rpc.summary?.unitsSold ?? 0,
    },
  };
}
