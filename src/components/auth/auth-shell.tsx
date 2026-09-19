import type { ReactNode } from "react";
import { BrandLogo } from "@/components/brand/brand-mark";

/**
 * Shell de las pantallas de acceso (login, activación de invitación).
 * Escritorio: composición dividida — panel de marca con el logo oficial a la
 * izquierda, formulario a la derecha. Móvil: logo arriba + formulario a ancho
 * completo, sin posicionamiento fijo (el teclado virtual no rompe nada).
 */
export function AuthShell({ children }: { children: ReactNode }) {
  const year = new Date().getFullYear();
  return (
    <div className="relative min-h-svh bg-background lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <aside className="relative hidden overflow-hidden border-r border-border bg-surface lg:flex lg:flex-col lg:justify-between lg:p-10 xl:p-14">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_45%_at_50%_42%,var(--brand-soft),transparent_72%)]"
        />
        <p className="relative text-[11px] font-semibold uppercase tracking-[0.28em] text-muted-foreground">
          Sistema de gestión del concesionario
        </p>
        <div className="relative flex flex-col items-center">
          <BrandLogo size={340} priority className="drop-shadow-[0_18px_40px_rgba(0,0,0,0.55)]" />
        </div>
        <div className="relative space-y-2">
          <p className="max-w-sm text-lg font-semibold leading-snug text-foreground">
            Ventas, financiación, cobros, comisiones y logística en un solo lugar.
          </p>
          <p className="text-xs text-muted-foreground">© {year} Smile Motors · Uso interno</p>
        </div>
      </aside>

      <main
        className="flex min-h-svh flex-col items-center justify-center px-5 sm:px-8"
        style={{
          paddingTop: "max(2rem, env(safe-area-inset-top))",
          paddingBottom: "max(2rem, env(safe-area-inset-bottom))",
        }}
      >
        <div className="w-full max-w-[400px]">
          <div className="mb-8 flex flex-col items-center lg:hidden">
            <BrandLogo size={120} priority />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
