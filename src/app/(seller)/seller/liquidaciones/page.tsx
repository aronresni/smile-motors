import type { Metadata } from "next";
import { requireZone } from "@/lib/auth/session";
import { getSellerLiquidationList } from "@/lib/seller/liquidations";
import { getSellerWeeklyLiquidation, parseWeekParam } from "@/lib/seller/weekly-liquidation";
import { SellerLiquidationList } from "@/components/seller/liquidaciones/seller-liquidation-list";
import { WeeklyHeader, WeeklySummaryCard } from "@/components/seller/liquidaciones/weekly/weekly-summary";
import { WeeklySalesTable } from "@/components/seller/liquidaciones/weekly/weekly-sales-table";
import { AlertTriangleIcon, CheckCircleIcon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "Mis liquidaciones · Vendedor" };
export const dynamic = "force-dynamic";

/**
 * "Mis liquidaciones" — vista SEMANAL del vendedor en dos grupos:
 *  1. Ventas confirmadas (VENDIDAS/PAGADAS confirmadas esta semana): su
 *     comisión congelada suma al "Total a liquidar".
 *  2. Próximas a confirmar (PENDIENTES, de esta semana y de semanas
 *     anteriores): comisión ESTIMADA, nunca incluida en la liquidación.
 */
export default async function SellerLiquidacionesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireZone("seller");
  const week = parseWeekParam((await searchParams).week);
  const [data, history] = await Promise.all([getSellerWeeklyLiquidation(week), getSellerLiquidationList()]);

  if (!data) {
    return (
      <EmptyState title="No pudimos cargar tu liquidación semanal." description="Recarga la página o inténtalo más tarde." />
    );
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      <WeeklyHeader data={data} />
      <WeeklySummaryCard data={data} />

      <section aria-labelledby="confirmed-title" className="space-y-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="confirmed-title" className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <CheckCircleIcon size={16} className="text-success" />
            Ventas confirmadas
          </h2>
          <span className="text-xs text-muted-foreground">{data.confirmedSales.length} ventas</span>
        </div>
        {data.confirmedSales.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
            Ninguna venta se marcó VENDIDA en esta semana.
          </div>
        ) : (
          <WeeklySalesTable rows={data.confirmedSales} kind="confirmed" label="Ventas confirmadas" />
        )}
      </section>

      <section aria-labelledby="upcoming-title" className="space-y-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="upcoming-title" className="text-sm font-semibold uppercase tracking-wide text-warning">
            Próximas a confirmar
          </h2>
          <span className="text-xs text-muted-foreground">{data.upcoming.length} ventas</span>
        </div>
        {data.upcoming.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border px-6 py-8 text-center text-sm text-muted-foreground">
            No hay ventas pendientes de esta semana.
          </div>
        ) : (
          <WeeklySalesTable rows={data.upcoming} kind="upcoming" label="Próximas a confirmar" />
        )}
      </section>

      {data.upcomingPrevious.length > 0 && (
        <section aria-labelledby="upcoming-previous-title" className="space-y-2.5">
          <h2
            id="upcoming-previous-title"
            className="flex items-center gap-2 rounded-xl border border-warning/40 bg-warning-soft px-3.5 py-2.5 text-sm font-semibold uppercase tracking-wide text-warning"
          >
            <AlertTriangleIcon size={16} className="shrink-0" />
            Próximas a confirmar de semanas anteriores — {data.upcomingPrevious.length}{" "}
            {data.upcomingPrevious.length === 1 ? "venta" : "ventas"}
          </h2>
          <p className="text-xs text-muted-foreground">
            Siguen aquí cada semana hasta que se marquen VENDIDAS. Su comisión es ESTIMADA y no se incluye en la
            liquidación.
          </p>
          <WeeklySalesTable
            rows={data.upcomingPrevious}
            kind="upcoming"
            label="Próximas a confirmar de semanas anteriores"
          />
        </section>
      )}

      <section aria-labelledby="history-title" className="space-y-2.5 pt-2">
        <h2 id="history-title" className="text-sm font-semibold text-foreground">
          Liquidaciones aprobadas y pagadas
        </h2>
        <SellerLiquidationList items={history} />
      </section>
    </div>
  );
}
