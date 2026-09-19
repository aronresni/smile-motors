import { cn } from "@/lib/utils";

/** Indicador de progreso circular (hereda `currentColor`). */
export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn("h-4 w-4 shrink-0 animate-spin", className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3.5" className="opacity-25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
    </svg>
  );
}
