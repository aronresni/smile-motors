/** Esqueleto del catálogo mientras la página de servidor resuelve datos. */
export default function SellerStockLoading() {
  return (
    <div className="space-y-4" aria-busy>
      <div className="space-y-2">
        <div className="h-7 w-40 animate-pulse rounded bg-surface-muted" />
        <div className="h-4 w-72 animate-pulse rounded bg-surface-muted" />
      </div>

      <div className="h-24 animate-pulse rounded-2xl border border-border bg-surface" />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-72 animate-pulse rounded-2xl border border-border bg-surface"
          />
        ))}
      </div>
    </div>
  );
}
