import { formatCents } from "@/lib/money";
import type { SalesTrendBucket } from "@/lib/admin/reports";

/** Gráfico de barras bespoke (SVG inline, sin librería) — mismo criterio ya
 * usado en el panel del vendedor. Un dataset de decenas de puntos, nunca
 * miles de filas crudas. */
export function TrendChart({ buckets, granularity }: { buckets: SalesTrendBucket[]; granularity: string }) {
  if (buckets.length === 0) {
    return <p className="text-sm text-muted-foreground">Sin datos en este período.</p>;
  }

  const W = 720;
  const H = 200;
  const padX = 8;
  const padTop = 10;
  const padBottom = 24;
  const chartW = W - padX * 2;
  const chartH = H - padTop - padBottom;
  const groupW = chartW / buckets.length;
  const barW = Math.max(3, Math.min(28, groupW - 6));
  const max = Math.max(1, ...buckets.map((b) => b.revenueCents));

  const labelEvery = Math.max(1, Math.ceil(buckets.length / 8));

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Ingresos por período">
        {buckets.map((b, i) => {
          const h = (b.revenueCents / max) * chartH;
          const x = padX + i * groupW + (groupW - barW) / 2;
          const y = padTop + (chartH - h);
          return (
            <g key={b.bucketStart}>
              <rect x={x} y={y} width={barW} height={Math.max(1, h)} rx={2} fill="currentColor" className="text-info/70" />
              {i % labelEvery === 0 && (
                <text x={x + barW / 2} y={H - 6} textAnchor="middle" fontSize="9" fill="currentColor" className="text-muted-foreground">
                  {shortLabel(b.bucketStart, granularity)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <p className="mt-1 text-center text-[11px] text-muted-foreground">
        Total del período: {formatCents(buckets.reduce((a, b) => a + b.revenueCents, 0))} · {buckets.reduce((a, b) => a + b.units, 0)} unidades
      </p>
    </div>
  );
}

function shortLabel(iso: string, granularity: string): string {
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  if (granularity === "month") {
    return new Intl.DateTimeFormat("es-DO", { month: "short", timeZone: "UTC" }).format(d);
  }
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}`;
}
