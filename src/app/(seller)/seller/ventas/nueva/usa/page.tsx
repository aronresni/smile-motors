import type { Metadata } from "next";
import Link from "next/link";
import { ROUTES } from "@/lib/constants";
import { buttonClasses } from "@/components/ui/button";

export const metadata: Metadata = { title: "Venta nacional (USA) · Vendedor" };

export default function NuevaVentaUsaPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">
          Venta nacional · USA
        </p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          Formulario en preparación
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          El flujo detallado de la venta nacional (EE. UU.) se implementa en la
          próxima entrega. Por ahora usa la operación de envío internacional a
          Cuba.
        </p>
      </div>

      <div className="rounded-2xl border border-dashed border-border bg-surface/60 px-5 py-10 text-center">
        <p className="text-sm text-text-secondary">Disponible pronto</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Campos e impuestos por estado, logística nacional y revisión.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          href={ROUTES.sellerVentaNueva}
          className={buttonClasses("secondary", "sm")}
        >
          ← Elegir otra operación
        </Link>
        <Link
          href={ROUTES.sellerVentaNuevaCuba}
          className={buttonClasses("primary", "sm")}
        >
          Ir a venta Cuba
        </Link>
      </div>
    </div>
  );
}
