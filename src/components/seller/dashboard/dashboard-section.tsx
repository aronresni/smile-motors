import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface DashboardSectionProps {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** Contenedor visual común de las secciones del panel. */
export function DashboardSection({
  title,
  description,
  action,
  className,
  children,
}: DashboardSectionProps) {
  return (
    <section
      className={cn(
        "rounded-2xl border border-border bg-surface p-4 sm:p-5",
        className,
      )}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {description && (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/** Estado vacío coherente para cualquier sección/gráfico. */
export function EmptyState({
  message,
  tall,
}: {
  message: string;
  tall?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-xl border border-dashed border-border/70 px-4 py-6 text-center text-xs text-muted-foreground",
        tall ? "min-h-[150px]" : "min-h-[110px]",
      )}
    >
      {message}
    </div>
  );
}
