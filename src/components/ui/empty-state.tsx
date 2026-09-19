import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Estado vacío intencional: qué pasa + (opcional) la acción útil siguiente. */
export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
  compact = false,
}: {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-2xl border border-dashed border-border-strong text-center",
        compact ? "px-4 py-8" : "px-6 py-14",
        className,
      )}
    >
      {icon && (
        <span className="mb-3 grid h-11 w-11 place-items-center rounded-full bg-surface-muted text-muted-foreground">
          {icon}
        </span>
      )}
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {description && <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">{description}</p>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}
