/** Lista de barras horizontales — liviana, segura en móvil (sin viewBox que
 * escalar), suficiente para "top N" sin agregar una librería de gráficos. */
export function BarList({
  items,
  formatValue,
}: {
  items: { label: string; value: number }[];
  formatValue: (v: number) => string;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">Sin datos en este período.</p>;
  }
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.label} className="text-sm">
          <div className="mb-0.5 flex items-center justify-between gap-2">
            <span className="truncate text-text-secondary">{item.label}</span>
            <span className="shrink-0 tabular-nums font-medium">{formatValue(item.value)}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-elevated">
            <div
              className="h-full rounded-full bg-info/30"
              style={{ width: `${Math.max(2, (item.value / max) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
