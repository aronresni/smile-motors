import { cn } from "@/lib/utils";
import { CheckIcon } from "@/components/ui/icons";

export interface ProcessStep {
  key: string;
  label: string;
  /** Texto secundario (fecha/actor). */
  meta?: string | null;
}

/**
 * Stepper compacto de un proceso lineal (p. ej. BORRADOR → PENDIENTE →
 * VENDIDA → PAGADA). Marca pasos completados, el actual y los futuros.
 * Horizontal en tablet/escritorio, compacto en móvil.
 */
export function ProcessStepper({
  steps,
  currentKey,
  className,
  ariaLabel = "Progreso del proceso",
}: {
  steps: ProcessStep[];
  currentKey: string;
  className?: string;
  ariaLabel?: string;
}) {
  const currentIdx = Math.max(0, steps.findIndex((s) => s.key === currentKey));
  return (
    <ol aria-label={ariaLabel} className={cn("flex w-full items-start", className)}>
      {steps.map((s, i) => {
        const done = i < currentIdx;
        const current = i === currentIdx;
        const last = i === steps.length - 1;
        return (
          <li
            key={s.key}
            aria-current={current ? "step" : undefined}
            className={cn("relative flex min-w-0 flex-1 flex-col items-center text-center", !last && "pr-1")}
          >
            {!last && (
              <span
                aria-hidden="true"
                className={cn(
                  "absolute left-[calc(50%+14px)] right-[calc(-50%+14px)] top-[13px] h-0.5 rounded-full",
                  i < currentIdx ? "bg-brand" : "bg-border-strong",
                )}
              />
            )}
            <span
              className={cn(
                "relative z-10 grid h-7 w-7 place-items-center rounded-full border-2 text-[11px] font-bold transition-colors",
                done && "border-brand bg-brand text-brand-foreground",
                current && (last ? "border-success bg-success text-brand-foreground" : "border-brand bg-background text-brand ring-4 ring-brand/15"),
                !done && !current && "border-border-strong bg-surface text-muted-foreground",
              )}
            >
              {done || (current && last) ? <CheckIcon size={14} strokeWidth={2.5} /> : i + 1}
            </span>
            <span
              className={cn(
                "mt-1.5 max-w-full truncate px-0.5 text-[10px] font-semibold uppercase tracking-wide sm:text-[11px]",
                current ? "text-foreground" : done ? "text-text-secondary" : "text-muted-foreground",
              )}
            >
              {s.label}
            </span>
            {s.meta && (
              <span className="hidden max-w-full truncate px-0.5 text-[10px] text-muted-foreground sm:block">{s.meta}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
