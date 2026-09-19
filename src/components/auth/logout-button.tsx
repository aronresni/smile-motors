import type { ReactNode } from "react";
import { ROUTES } from "@/lib/constants";

/**
 * Botón de cierre de sesión. Es un `<form>` que hace POST a la route de
 * signout — funciona sin JavaScript. Único para admin y vendedor.
 */
export function LogoutButton({
  className,
  children,
  label = "Cerrar sesión",
  iconOnly = false,
}: {
  className?: string;
  children?: ReactNode;
  label?: string;
  /** Solo icono: el texto queda como etiqueta accesible. */
  iconOnly?: boolean;
}) {
  return (
    <form action={ROUTES.signOut} method="post">
      <button
        type="submit"
        aria-label={iconOnly ? label : undefined}
        title={iconOnly ? label : undefined}
        className={
          className ??
          "rounded-xl border border-border-strong px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-elevated hover:text-foreground"
        }
      >
        {children ?? label}
      </button>
    </form>
  );
}
