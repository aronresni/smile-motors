import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";

/**
 * Botón ÚNICO de la aplicación (Smile Motors).
 *  - primary   → amarillo de marca (acción principal de la pantalla).
 *  - secondary → superficie + borde (acciones neutras).
 *  - ghost     → sin fondo (acciones terciarias / navegación).
 *  - danger    → contorno rojo (acciones destructivas, con confirmación).
 *  - danger-solid → rojo sólido (el CTA final dentro de una confirmación destructiva).
 *  - subtle    → superficie tenue.
 *
 * `loading` deshabilita el botón (evita doble envío), muestra un spinner y,
 * si se pasa `loadingText`, cambia la etiqueta ("MARCANDO COMO PAGADA…").
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "danger-solid" | "subtle";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-brand text-brand-foreground shadow-[0_1px_0_rgba(255,255,255,0.25)_inset] hover:bg-brand-hover active:bg-brand-hover",
  secondary:
    "border border-border-strong bg-surface text-foreground hover:bg-surface-elevated hover:border-muted-foreground/40",
  ghost: "text-text-secondary hover:bg-surface-elevated hover:text-foreground",
  danger: "border border-danger/45 text-danger hover:bg-danger-surface",
  "danger-solid": "bg-danger text-white hover:bg-danger/90",
  subtle: "bg-surface-muted text-text-secondary hover:bg-surface-elevated hover:text-foreground",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "min-h-8 px-3 py-1.5 text-xs",
  md: "min-h-10 px-4 py-2.5 text-sm",
  lg: "min-h-12 px-5 py-3 text-sm tracking-wide",
};

export function buttonClasses(
  variant: ButtonVariant = "secondary",
  size: ButtonSize = "md",
  className?: string,
): string {
  return cn(
    "inline-flex select-none items-center justify-center gap-2 rounded-xl font-semibold transition-[background-color,border-color,color,transform] duration-150",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "active:translate-y-px disabled:pointer-events-none disabled:opacity-50",
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

type ButtonProps = ComponentPropsWithoutRef<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Etiqueta mientras `loading` (p. ej. "Marcando como pagada…"). */
  loadingText?: ReactNode;
  icon?: ReactNode;
};

export function Button({
  variant = "secondary",
  size = "md",
  className,
  type = "button",
  loading = false,
  loadingText,
  icon,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClasses(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} /> : icon}
      {loading && loadingText ? loadingText : children}
    </button>
  );
}
