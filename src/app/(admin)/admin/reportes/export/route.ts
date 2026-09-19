import { NextRequest } from "next/server";
import { requireZone } from "@/lib/auth/session";
import { toCsv, csvFileName, csvResponse, centsToDecimal } from "@/lib/admin/csv";
import {
  getSellersReport,
  getProductsReport,
  getFinancingReport,
  getCollectionReport,
  getCommissionsReport,
  getLiquidationsReport,
} from "@/lib/admin/reports";

/**
 * Export CSV server-side — SIEMPRE re-ejecuta el mismo RPC agregado con el
 * mismo período/filtros que la pantalla (nunca "solo la página actual": estos
 * RPC ya devuelven el conjunto agregado completo, no una lista paginada de
 * filas crudas). Admin-only (`requireZone`, más el propio RPC vuelve a
 * verificar `is_admin()` server-side). Nunca incluye documentos de
 * identidad ni datos sensibles — solo campos de negocio ya usados en pantalla.
 */
export async function GET(request: NextRequest) {
  await requireZone("admin");

  const sp = request.nextUrl.searchParams;
  const report = sp.get("report") ?? "";
  const start = sp.get("start") || null;
  const end = sp.get("end") || null;
  const range = { start, end };

  switch (report) {
    case "sellers": {
      const items = await getSellersReport(range);
      const csv = toCsv(
        ["Vendedor", "Ventas", "Unidades", "Ingresos", "Pending", "Sold", "Paid", "Comisión (venta por cobrar)", "Comisión (venta cobrada)", "Liquidado/pagado"],
        items.map((r) => [
          r.sellerName, r.salesCount, r.units, centsToDecimal(r.revenueCents),
          r.pendingCount, r.soldCount, r.paidCount,
          centsToDecimal(r.commissionPendingCents), centsToDecimal(r.commissionEligibleCents), centsToDecimal(r.liquidationPaidCents),
        ]),
      );
      return csvResponse(csvFileName("vendedores", start, end), csv);
    }
    case "products": {
      const items = await getProductsReport(range);
      const csv = toCsv(
        ["Producto", "Categoría", "Unidades vendidas", "Ventas", "Ingresos", "Precio promedio vendido", "Pending", "Sold", "Paid", "Comisión generada"],
        items.map((r) => [
          r.productName, r.category ?? "", r.unitsSold, r.salesCount, centsToDecimal(r.revenueCents),
          r.avgSalePriceCents == null ? "" : centsToDecimal(r.avgSalePriceCents),
          r.pendingUnits, r.soldUnits, r.paidUnits, centsToDecimal(r.commissionGeneratedCents),
        ]),
      );
      return csvResponse(csvFileName("productos", start, end), csv);
    }
    case "financing": {
      const { providers, directPayments } = await getFinancingReport(range);
      const csv = toCsv(
        ["Tipo", "Proveedor/Método", "Ventas", "Asignaciones", "Bruto asignado", "Fees", "Neto asignado", "Neto acreditado", "Contratos enviados", "Contratos firmados", "Contratos acreditados"],
        [
          ...providers.map((p) => [
            "Financiera", p.providerName, p.salesCount, p.allocationsCount,
            centsToDecimal(p.grossAllocatedCents), centsToDecimal(p.feesCents), centsToDecimal(p.netAllocatedCents), centsToDecimal(p.netAccreditedCents),
            p.contractsSent, p.contractsSigned, p.contractsAccredited,
          ]),
          ...directPayments.map((d) => [
            "Pago directo", d.methodType, "", "", centsToDecimal(d.allocatedCents), "", centsToDecimal(d.settledCents), centsToDecimal(d.pendingCents), "", "", "",
          ]),
        ],
      );
      return csvResponse(csvFileName("financieras", start, end), csv);
    }
    case "collection": {
      const c = await getCollectionReport(range);
      const csv = toCsv(
        ["Métrica", "Valor"],
        [
          ["Pendiente a cobrar (actual)", centsToDecimal(c.current.totalOutstandingCents)],
          ["Cobrado/acreditado (actual)", centsToDecimal(c.current.totalSettledCents)],
          ["Ventas pendientes a cobrar (actual)", c.current.pendingCollectionCount],
          ["Ventas listas para pagar (actual)", c.current.readyToPayCount],
          ["Antigüedad 0-2 días", c.current.agingBuckets.d0to2],
          ["Antigüedad 3-7 días", c.current.agingBuckets.d3to7],
          ["Antigüedad 8-14 días", c.current.agingBuckets.d8to14],
          ["Antigüedad 15+ días", c.current.agingBuckets.d15plus],
          ["Ventas pagadas en el período", c.period.paidSalesCount],
          ["Monto pagado en el período", centsToDecimal(c.period.paidAmountCents)],
        ],
      );
      return csvResponse(csvFileName("cobros", start, end), csv);
    }
    case "commissions": {
      const c = await getCommissionsReport(range);
      const csv = toCsv(
        ["Vendedor", "Comisión venta por cobrar (actual)", "Comisión venta cobrada (actual)"],
        c.bySeller.map((r) => [r.sellerName, centsToDecimal(r.pendingCents), centsToDecimal(r.eligibleCents)]),
      );
      return csvResponse(csvFileName("comisiones", start, end), csv);
    }
    case "liquidations": {
      const l = await getLiquidationsReport(range);
      const csv = toCsv(
        ["Vendedor", "Semana", "Subtotal comisiones", "Ajustes", "Total pagado", "Fecha de pago"],
        l.items.map((r) => [r.sellerName, `${r.weekStart} - ${r.weekEnd}`, centsToDecimal(r.commissionSubtotalCents), centsToDecimal(r.adjustmentsCents), centsToDecimal(r.totalToPayCents), r.paidAt]),
      );
      return csvResponse(csvFileName("liquidaciones", start, end), csv);
    }
    default:
      return new Response("Reporte desconocido", { status: 400 });
  }
}
