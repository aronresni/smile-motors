import Link from "next/link";
import { ROUTES } from "@/lib/constants";
import { PlusIcon } from "@/components/seller/icons";

/** Sin ninguna venta en la cuenta. */
export function SalesListEmptyNoSales() {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-surface/60 px-6 py-14 text-center">
      <p className="text-sm font-medium text-text-secondary">
        No tienes ventas todavía.
      </p>
      <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
        Cuando registres una operación, aparecerá aquí con su estado, cliente y
        total.
      </p>
      <Link
        href={ROUTES.sellerVentaNueva}
        prefetch
        className="mt-5 inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-foreground shadow-sm transition hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 active:scale-[0.98]"
      >
        <PlusIcon size={18} />
        Nueva venta
      </Link>
    </div>
  );
}

/** Hay ventas, pero los filtros actuales no devuelven ninguna. */
export function SalesListEmptyFiltered({ basePath }: { basePath: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-surface/60 px-6 py-14 text-center">
      <p className="text-sm font-medium text-text-secondary">
        No encontramos ventas con estos filtros.
      </p>
      <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
        Prueba con otro período, estado o término de búsqueda.
      </p>
      <Link
        href={basePath}
        prefetch={false}
        scroll={false}
        className="mt-5 inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-text-secondary transition-colors hover:text-foreground"
      >
        Limpiar filtros
      </Link>
    </div>
  );
}
