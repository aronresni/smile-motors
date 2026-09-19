import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Resumen de comisión de UNA venta — compartido por Admin Sale Detail, Seller
 * Sale Detail y la revisión previa al envío. La RPC (`security invoker`) ya
 * restringe a `sale_is_own(sale_id) or is_admin()`; las lecturas de unidades y
 * productos pasan por RLS (dueño o admin; el vendedor ve el catálogo activo).
 *
 * - `items`: comisiones CONGELADAS al marcar VENDIDA (snapshot inmutable).
 * - `estimates`: solo mientras la venta es BORRADOR o PENDIENTE, las unidades
 *   aún sin comisión con el precio fijo / comisión fija VIGENTES del producto.
 */
export interface SaleCommissionItem {
  saleUnitId: string;
  productName: string;
  variantName: string | null;
  referencePriceCents: number;
  salePriceCents: number;
  priceDifferenceCents: number;
  baseCommissionCents: number;
  sellerDifferenceShareCents: number;
  finalCommissionCents: number;
  status: "PENDING" | "ELIGIBLE" | "VOID";
  eligibleAt: string | null;
}

export interface SaleCommissionEstimate {
  saleUnitId: string;
  productId: string | null;
  productName: string;
  variantName: string | null;
  salePriceCents: number;
  /** `null` = sin configurar (o producto no visible para quien consulta). */
  fixedPriceCents: number | null;
  fixedCommissionCents: number | null;
}

export interface SaleCommissionView {
  totalCents: number;
  items: SaleCommissionItem[];
  estimates: SaleCommissionEstimate[];
}

export async function getSaleCommissionSummary(saleId: string): Promise<SaleCommissionView> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sale_commission_summary", { p_sale_id: saleId });
  const res = !error && data ? (data as unknown as { totalCents?: number; items?: SaleCommissionItem[] }) : {};
  const items = res.items ?? [];
  const totalCents = res.totalCents ?? 0;

  const { data: sale } = await supabase.from("sales").select("status").eq("id", saleId).maybeSingle();
  if (!sale || !["DRAFT", "PENDING"].includes(sale.status)) return { totalCents, items, estimates: [] };

  const frozen = new Set(items.map((i) => i.saleUnitId));
  const { data: units } = await supabase
    .from("sale_units")
    .select("id, product_id, product_name_snapshot, variant_snapshot, agreed_price_cents, position")
    .eq("sale_id", saleId)
    .order("position");
  const pending = (units ?? []).filter((u) => !frozen.has(u.id));
  const productIds = [...new Set(pending.map((u) => u.product_id).filter((id): id is string => Boolean(id)))];
  const { data: products } = productIds.length
    ? await supabase
        .from("products")
        .select("id, default_reference_price_cents, default_base_commission_cents")
        .in("id", productIds)
    : { data: [] };
  const byId = new Map((products ?? []).map((p) => [p.id, p]));

  return {
    totalCents,
    items,
    estimates: pending.map((u) => {
      const p = u.product_id ? byId.get(u.product_id) : undefined;
      return {
        saleUnitId: u.id,
        productId: u.product_id,
        productName: u.product_name_snapshot ?? "",
        variantName: u.variant_snapshot ?? null,
        salePriceCents: Number(u.agreed_price_cents) || 0,
        fixedPriceCents: p?.default_reference_price_cents ?? null,
        fixedCommissionCents: p?.default_base_commission_cents ?? null,
      };
    }),
  };
}

/** Precio fijo / comisión fija VIGENTES de varios productos (RLS: admin ve todos; vendedor, los activos). */
export async function getProductsPricing(
  productIds: string[],
): Promise<Record<string, { fixedPriceCents: number | null; fixedCommissionCents: number | null }>> {
  const ids = [...new Set(productIds.filter(Boolean))];
  if (ids.length === 0) return {};
  const supabase = await createClient();
  const { data } = await supabase
    .from("products")
    .select("id, default_reference_price_cents, default_base_commission_cents")
    .in("id", ids);
  return Object.fromEntries(
    (data ?? []).map((p) => [
      p.id,
      { fixedPriceCents: p.default_reference_price_cents, fixedCommissionCents: p.default_base_commission_cents },
    ]),
  );
}
