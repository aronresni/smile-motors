import type { Metadata } from "next";
import {
  getDealerToday,
  getReportsOverview,
  getSalesTrend,
  getReportsFunnel,
  getSellersReport,
  getProductsReport,
  getTopProducts,
  getFinancingReport,
  getCollectionReport,
  getCommissionsReport,
  getLiquidationsReport,
} from "@/lib/admin/reports";
import { resolveReportPeriod, parseReportPeriodParams } from "@/lib/admin/reports-period";
import { ReportPeriodPicker } from "@/components/admin/reports/report-period-picker";
import { ReportTabsNav, REPORT_TAB_VALUES, type ReportTab } from "@/components/admin/reports/report-tabs-nav";
import { ResumenTab } from "@/components/admin/reports/tabs/resumen-tab";
import { VentasTab } from "@/components/admin/reports/tabs/ventas-tab";
import { VendedoresTab } from "@/components/admin/reports/tabs/vendedores-tab";
import { ProductosTab } from "@/components/admin/reports/tabs/productos-tab";
import { FinancierasTab } from "@/components/admin/reports/tabs/financieras-tab";
import { CobrosTab } from "@/components/admin/reports/tabs/cobros-tab";
import { ComisionesTab } from "@/components/admin/reports/tabs/comisiones-tab";
import { LiquidacionesTab } from "@/components/admin/reports/tabs/liquidaciones-tab";

export const metadata: Metadata = { title: "Reportes · Admin" };
export const dynamic = "force-dynamic";

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v ?? "").trim();
}

export default async function AdminReportesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const tabRaw = first(sp.tab) as ReportTab;
  const tab: ReportTab = REPORT_TAB_VALUES.includes(tabRaw) ? tabRaw : "resumen";
  const sort = first(sp.sort) || "revenue";
  const order = first(sp.order) || "desc";

  const { preset, customStart, customEnd } = parseReportPeriodParams(sp);
  const dealerToday = (await getDealerToday()) ?? new Date().toISOString().slice(0, 10);
  const period = resolveReportPeriod(preset, dealerToday, customStart, customEnd);
  const range = { start: period.start, end: period.end };

  const periodQsParams = new URLSearchParams();
  periodQsParams.set("period", period.preset);
  if (period.preset === "custom") {
    if (period.start) periodQsParams.set("start", period.start);
    if (period.end) periodQsParams.set("end", period.end);
  }
  const periodQs = periodQsParams.toString();

  let content: React.ReactNode = null;
  switch (tab) {
    case "resumen": {
      const overview = await getReportsOverview(range);
      content = <ResumenTab overview={overview} />;
      break;
    }
    case "ventas": {
      const [{ granularity, buckets }, funnel] = await Promise.all([getSalesTrend(range), getReportsFunnel(range)]);
      content = <VentasTab trend={buckets} granularity={granularity} funnel={funnel} />;
      break;
    }
    case "vendedores": {
      const items = await getSellersReport(range, sort, order);
      content = <VendedoresTab items={items} sort={sort} order={order} periodQs={periodQs} start={range.start} end={range.end} />;
      break;
    }
    case "productos": {
      const [items, topByUnits] = await Promise.all([getProductsReport(range), getTopProducts(range, "units", 8)]);
      content = <ProductosTab items={items} topByUnits={topByUnits} start={range.start} end={range.end} />;
      break;
    }
    case "financieras": {
      const { providers, directPayments } = await getFinancingReport(range);
      content = <FinancierasTab providers={providers} directPayments={directPayments} start={range.start} end={range.end} />;
      break;
    }
    case "cobros": {
      const report = await getCollectionReport(range);
      content = <CobrosTab report={report} start={range.start} end={range.end} />;
      break;
    }
    case "comisiones": {
      const report = await getCommissionsReport(range);
      content = <ComisionesTab report={report} start={range.start} end={range.end} />;
      break;
    }
    case "liquidaciones": {
      const report = await getLiquidationsReport(range);
      content = <LiquidacionesTab report={report} start={range.start} end={range.end} />;
      break;
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Reportes</h1>
        <p className="text-sm text-muted-foreground">
          Analítica agregada sobre datos ya autoritativos — ninguna fórmula de comisión, liquidación o cobro se
          recalcula aquí. Fechas en hora del Este ({"America/New_York"}).
        </p>
      </div>

      <ReportPeriodPicker tab={tab} period={period} />
      <ReportTabsNav active={tab} periodQs={periodQs} />

      {content}
    </div>
  );
}
