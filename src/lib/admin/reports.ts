import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Reportes & Analytics — capa de datos de solo lectura. Cada RPC agrega
 * 100% server-side sobre datos ya autoritativos (`sales`, `sale_units`,
 * `sale_commissions`, `weekly_liquidations`, `sale_payment_allocations`,
 * `sale_financing_contracts`) — nunca recalcula comisión/liquidación/
 * settlement, y nunca descarga filas crudas para agregar en React.
 *
 * SEMÁNTICA DE FECHAS — nunca se mezclan (ver cada tipo/función):
 *   - Actividad comercial (ventas/unidades/ingresos): `sale_date`.
 *   - Pagado: `paid_at`.
 *   - Elegibilidad de comisión: `eligible_at`.
 *   - Pago de liquidación: `weekly_liquidations.paid_at`.
 *   - Eventos de contrato: sus columnas *_at reales.
 * "Estado ACTUAL" (pendiente a cobrar, comisiones elegibles/pendientes,
 * ventas pendientes, conteos DRAFT/APPROVED/PAID) es SIEMPRE una foto de
 * ahora mismo — el filtro de período NUNCA lo afecta (documentado también
 * en la migración SQL).
 */

export interface DateRangeParams {
  start?: string | null;
  end?: string | null;
}

function rpcArgs({ start, end }: DateRangeParams) {
  return { p_start: start ?? undefined, p_end: end ?? undefined };
}

export async function getDealerToday(): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_dealer_today");
  if (error || !data) return null;
  const res = data as unknown as { ok: boolean; today?: string };
  return res.ok ? (res.today ?? null) : null;
}

export interface ReportsOverview {
  period: {
    commercialSalesCount: number;
    unitsSold: number;
    commercialRevenueCents: number;
    paidSalesCount: number;
    paidAmountCents: number;
    liquidationsPaidAmountCents: number;
  };
  current: {
    pendingSalesCount: number;
    outstandingCollectionCents: number;
    eligibleCommissionCents: number;
  };
}

const EMPTY_OVERVIEW: ReportsOverview = {
  period: { commercialSalesCount: 0, unitsSold: 0, commercialRevenueCents: 0, paidSalesCount: 0, paidAmountCents: 0, liquidationsPaidAmountCents: 0 },
  current: { pendingSalesCount: 0, outstandingCollectionCents: 0, eligibleCommissionCents: 0 },
};

export async function getReportsOverview(range: DateRangeParams): Promise<ReportsOverview> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_reports_overview", rpcArgs(range));
  if (error || !data) return EMPTY_OVERVIEW;
  const res = data as unknown as { ok: boolean } & Partial<ReportsOverview>;
  if (!res.ok) return EMPTY_OVERVIEW;
  return { period: { ...EMPTY_OVERVIEW.period, ...res.period }, current: { ...EMPTY_OVERVIEW.current, ...res.current } };
}

export interface SalesTrendBucket {
  bucketStart: string;
  salesCount: number;
  units: number;
  revenueCents: number;
}

export async function getSalesTrend(range: DateRangeParams): Promise<{ granularity: string; buckets: SalesTrendBucket[] }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_reports_sales_trend", rpcArgs(range));
  if (error || !data) return { granularity: "day", buckets: [] };
  const res = data as unknown as { ok: boolean; granularity?: string; buckets?: SalesTrendBucket[] };
  if (!res.ok) return { granularity: "day", buckets: [] };
  return { granularity: res.granularity ?? "day", buckets: res.buckets ?? [] };
}

export interface ConversionStat {
  sampleSize: number;
  avgHours: number;
  medianHours: number;
}
export interface ReportsFunnel {
  counts: { pending: number; sold: number; paid: number };
  conversion: { pendingToSold: ConversionStat | null; soldToPaid: ConversionStat | null };
}

export async function getReportsFunnel(range: DateRangeParams): Promise<ReportsFunnel> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_reports_funnel", rpcArgs(range));
  const empty: ReportsFunnel = { counts: { pending: 0, sold: 0, paid: 0 }, conversion: { pendingToSold: null, soldToPaid: null } };
  if (error || !data) return empty;
  const res = data as unknown as { ok: boolean } & Partial<ReportsFunnel>;
  if (!res.ok) return empty;
  return { counts: { ...empty.counts, ...res.counts }, conversion: { ...empty.conversion, ...res.conversion } };
}

export interface SellerReportRow {
  sellerId: string;
  sellerName: string;
  salesCount: number;
  units: number;
  revenueCents: number;
  pendingCount: number;
  soldCount: number;
  paidCount: number;
  commissionPendingCents: number;
  commissionEligibleCents: number;
  liquidationPaidCents: number;
}

export async function getSellersReport(range: DateRangeParams, sort = "revenue", order = "desc"): Promise<SellerReportRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_reports_sellers", { ...rpcArgs(range), p_sort: sort, p_order: order });
  if (error || !data) return [];
  const res = data as unknown as { ok: boolean; items?: SellerReportRow[] };
  return res.ok ? (res.items ?? []) : [];
}

export interface ProductReportRow {
  productId: string;
  productName: string;
  category: string | null;
  unitsSold: number;
  salesCount: number;
  revenueCents: number;
  avgSalePriceCents: number | null;
  pendingUnits: number;
  soldUnits: number;
  paidUnits: number;
  commissionGeneratedCents: number;
}

export async function getProductsReport(
  range: DateRangeParams,
  category?: string | null,
): Promise<ProductReportRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_reports_products", {
    ...rpcArgs(range), p_category: category ?? undefined,
  });
  if (error || !data) return [];
  const res = data as unknown as { ok: boolean; items?: ProductReportRow[] };
  return res.ok ? (res.items ?? []) : [];
}

export interface TopProductRow {
  productId: string;
  productName: string;
  units: number;
  revenueCents: number;
}

export async function getTopProducts(range: DateRangeParams, metric: "units" | "revenue" = "units", limit = 8): Promise<TopProductRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_reports_top_products", { ...rpcArgs(range), p_metric: metric, p_limit: limit });
  if (error || !data) return [];
  const res = data as unknown as { ok: boolean; items?: TopProductRow[] };
  return res.ok ? (res.items ?? []) : [];
}

export interface FinancingProviderRow {
  providerName: string;
  salesCount: number;
  allocationsCount: number;
  grossAllocatedCents: number;
  feesCents: number;
  netAllocatedCents: number;
  netAccreditedCents: number;
  contractsSent: number;
  contractsSigned: number;
  contractsAccredited: number;
}
export interface DirectPaymentRow {
  methodType: string;
  allocatedCents: number;
  settledCents: number;
  pendingCents: number;
}

export async function getFinancingReport(range: DateRangeParams): Promise<{ providers: FinancingProviderRow[]; directPayments: DirectPaymentRow[] }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_reports_financing", rpcArgs(range));
  if (error || !data) return { providers: [], directPayments: [] };
  const res = data as unknown as { ok: boolean; providers?: FinancingProviderRow[]; directPayments?: DirectPaymentRow[] };
  if (!res.ok) return { providers: [], directPayments: [] };
  return { providers: res.providers ?? [], directPayments: res.directPayments ?? [] };
}

export interface CollectionReport {
  current: {
    totalOutstandingCents: number;
    totalSettledCents: number;
    pendingCollectionCount: number;
    readyToPayCount: number;
    agingBuckets: { d0to2: number; d3to7: number; d8to14: number; d15plus: number };
  };
  period: { paidSalesCount: number; paidAmountCents: number };
}

const EMPTY_COLLECTION: CollectionReport = {
  current: { totalOutstandingCents: 0, totalSettledCents: 0, pendingCollectionCount: 0, readyToPayCount: 0, agingBuckets: { d0to2: 0, d3to7: 0, d8to14: 0, d15plus: 0 } },
  period: { paidSalesCount: 0, paidAmountCents: 0 },
};

export async function getCollectionReport(range: DateRangeParams): Promise<CollectionReport> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_reports_collection", rpcArgs(range));
  if (error || !data) return EMPTY_COLLECTION;
  const res = data as unknown as { ok: boolean } & Partial<CollectionReport>;
  if (!res.ok) return EMPTY_COLLECTION;
  return {
    current: { ...EMPTY_COLLECTION.current, ...res.current, agingBuckets: { ...EMPTY_COLLECTION.current.agingBuckets, ...res.current?.agingBuckets } },
    period: { ...EMPTY_COLLECTION.period, ...res.period },
  };
}

export interface CommissionBySeller { sellerId: string; sellerName: string; pendingCents: number; eligibleCents: number }
export interface CommissionByProduct { productId: string; productName: string; commissionCents: number }
export interface CommissionTrendPoint { date: string; eligibleCents: number }
export interface CommissionsReport {
  current: { pendingCount: number; pendingCents: number; eligibleCount: number; eligibleCents: number };
  bySeller: CommissionBySeller[];
  byProduct: CommissionByProduct[];
  eligibleTrend: CommissionTrendPoint[];
  avgCommissionPerUnitCents: number | null;
}

const EMPTY_COMMISSIONS: CommissionsReport = {
  current: { pendingCount: 0, pendingCents: 0, eligibleCount: 0, eligibleCents: 0 },
  bySeller: [], byProduct: [], eligibleTrend: [], avgCommissionPerUnitCents: null,
};

export async function getCommissionsReport(range: DateRangeParams): Promise<CommissionsReport> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_reports_commissions", rpcArgs(range));
  if (error || !data) return EMPTY_COMMISSIONS;
  const res = data as unknown as { ok: boolean } & Partial<CommissionsReport>;
  if (!res.ok) return EMPTY_COMMISSIONS;
  return {
    current: { ...EMPTY_COMMISSIONS.current, ...res.current },
    bySeller: res.bySeller ?? [], byProduct: res.byProduct ?? [], eligibleTrend: res.eligibleTrend ?? [],
    avgCommissionPerUnitCents: res.avgCommissionPerUnitCents ?? null,
  };
}

export interface LiquidationPaidInPeriod {
  commissionSubtotalCents: number;
  bonusesCents: number;
  positiveAdjustmentsCents: number;
  negativeAdjustmentsCents: number;
  finalPayoutCents: number;
  liquidationsCount: number;
}
export interface LiquidationReportItem {
  liquidationId: string;
  sellerId: string;
  sellerName: string;
  weekStart: string;
  weekEnd: string;
  commissionSubtotalCents: number;
  adjustmentsCents: number;
  totalToPayCents: number;
  paidAt: string;
}
export interface LiquidationsReport {
  counts: { draft: number; approved: number; paid: number };
  paidInPeriod: LiquidationPaidInPeriod;
  items: LiquidationReportItem[];
}

const EMPTY_LIQUIDATIONS: LiquidationsReport = {
  counts: { draft: 0, approved: 0, paid: 0 },
  paidInPeriod: { commissionSubtotalCents: 0, bonusesCents: 0, positiveAdjustmentsCents: 0, negativeAdjustmentsCents: 0, finalPayoutCents: 0, liquidationsCount: 0 },
  items: [],
};

export async function getLiquidationsReport(range: DateRangeParams): Promise<LiquidationsReport> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_reports_liquidations", rpcArgs(range));
  if (error || !data) return EMPTY_LIQUIDATIONS;
  const res = data as unknown as { ok: boolean } & Partial<LiquidationsReport>;
  if (!res.ok) return EMPTY_LIQUIDATIONS;
  return {
    counts: { ...EMPTY_LIQUIDATIONS.counts, ...res.counts },
    paidInPeriod: { ...EMPTY_LIQUIDATIONS.paidInPeriod, ...res.paidInPeriod },
    items: res.items ?? [],
  };
}
