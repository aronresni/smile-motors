/** Esqueleto de "Mis ventas" mientras la página de servidor resuelve datos. */
export default function SellerVentasLoading() {
  return (
    <div className="space-y-4 sm:space-y-5" aria-busy>
      <div className="space-y-2">
        <div className="h-3 w-24 animate-pulse rounded bg-surface-muted" />
        <div className="h-7 w-64 animate-pulse rounded bg-surface-muted" />
        <div className="h-4 w-80 animate-pulse rounded bg-surface-muted" />
      </div>

      <div className="h-24 animate-pulse rounded-2xl border border-border bg-surface" />

      <div className="grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-2xl border border-border bg-surface"
          />
        ))}
      </div>

      <div className="space-y-2.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-20 animate-pulse rounded-2xl border border-border bg-surface lg:h-14"
          />
        ))}
      </div>
    </div>
  );
}
