import { cn } from "@/lib/utils";
import { actorLabel, initialsOf, roleLabel, UNKNOWN_ACTOR } from "@/lib/identity/person";
import type { Role } from "@/lib/constants";

/**
 * Quién hizo algo — el ÚNICO componente para mostrarlo, en toda la app.
 *
 *   [AR]  Aron Resnicoff
 *         Administrador · 21 sep, 16:42
 *
 * Cuando un registro histórico no guardó a su autor, lo dice ("Sin registro
 * de autor") en vez de inventar a alguien o atribuirlo a quien está mirando.
 */
export function ActorIdentity({
  name,
  role,
  timestamp,
  size = "md",
  className,
}: {
  name: string | null | undefined;
  role?: Role | string | null;
  /** Ya formateado por quien llama (la app tiene su propio formateo). */
  timestamp?: string | null;
  size?: "sm" | "md";
  className?: string;
}) {
  const label = actorLabel({ name: name ?? null });
  const unknown = label === UNKNOWN_ACTOR;
  const meta = [roleLabel(role), timestamp].filter(Boolean).join(" · ");

  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full border font-semibold",
          unknown
            ? "border-border bg-surface-muted text-muted-foreground"
            : "border-brand/40 bg-brand-soft text-brand",
          size === "sm" ? "h-6 w-6 text-[9px]" : "h-8 w-8 text-[11px]",
        )}
      >
        {unknown ? "—" : initialsOf(label)}
      </span>
      <span className="min-w-0">
        <span
          className={cn(
            "block truncate font-medium",
            size === "sm" ? "text-xs" : "text-sm",
            unknown ? "text-muted-foreground italic" : "text-foreground",
          )}
        >
          {label}
        </span>
        {meta && (
          <span className="block truncate text-[11px] text-muted-foreground">{meta}</span>
        )}
      </span>
    </span>
  );
}
