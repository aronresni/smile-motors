import { cn } from "@/lib/utils";

/** Bloque de carga (pulso sutil; respeta prefers-reduced-motion vía CSS global). */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-lg bg-surface-elevated", className)} />;
}

/** Esqueleto genérico de página de listado: cabecera + filtros + filas. */
export function PageSkeleton({ rows = 6, kpis = 0 }: { rows?: number; kpis?: number }) {
  return (
    <div className="space-y-5" role="status" aria-label="Cargando">
      <div className="space-y-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      {kpis > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: kpis }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-10 w-full sm:w-72" />
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-10 w-32" />
      </div>
      <div className="overflow-hidden rounded-2xl border border-border">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-border px-4 py-3.5 last:border-0">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="hidden h-4 w-20 sm:block" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        ))}
      </div>
      <span className="sr-only">Cargando…</span>
    </div>
  );
}

/** Esqueleto de ficha de detalle (cabecera + stepper + secciones). */
export function DetailSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Cargando">
      <Skeleton className="h-7 w-56" />
      <Skeleton className="h-4 w-80 max-w-full" />
      <Skeleton className="h-16 w-full" />
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="space-y-4">
          <Skeleton className="h-40" />
          <Skeleton className="h-56" />
          <Skeleton className="h-40" />
        </div>
        <Skeleton className="hidden h-72 lg:block" />
      </div>
      <span className="sr-only">Cargando…</span>
    </div>
  );
}
