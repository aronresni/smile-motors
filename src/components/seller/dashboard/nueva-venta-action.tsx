import Link from "next/link";
import { ROUTES } from "@/lib/constants";
import { PlusIcon } from "@/components/seller/icons";
import { cn } from "@/lib/utils";

/** Acción primaria del panel. Tratamiento propio: botón ámbar sólido. */
export function NuevaVentaAction({ className }: { className?: string }) {
  return (
    <Link
      href={ROUTES.sellerVentaNueva}
      prefetch
      className={cn(
        "inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-accent-foreground shadow-sm transition hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 active:scale-[0.98] sm:w-auto sm:py-2.5",
        className,
      )}
    >
      <PlusIcon size={18} />
      Nueva venta
    </Link>
  );
}
