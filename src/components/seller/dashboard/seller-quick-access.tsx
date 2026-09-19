import Link from "next/link";
import type { ReactNode } from "react";
import { ROUTES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { PercentIcon, PlusIcon, ReceiptIcon } from "@/components/ui/icons";

function Tile({
  href,
  label,
  hint,
  icon,
  primary,
}: {
  href: string;
  label: string;
  hint: string;
  icon: ReactNode;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      prefetch
      className={cn(
        "group flex flex-col items-center gap-1.5 rounded-2xl border p-3 text-center transition-colors active:scale-[0.98] sm:flex-row sm:gap-3 sm:p-4 sm:text-left",
        primary
          ? "border-brand bg-brand text-brand-foreground hover:bg-brand-hover"
          : "border-border bg-surface text-foreground hover:border-border-strong hover:bg-surface-muted",
      )}
    >
      <span
        className={cn(
          "grid h-10 w-10 shrink-0 place-items-center rounded-xl",
          primary ? "bg-brand-foreground/10" : "bg-brand-soft text-brand",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold leading-tight sm:text-sm">{label}</span>
        <span className={cn("hidden text-xs sm:block", primary ? "text-brand-foreground/75" : "text-muted-foreground")}>
          {hint}
        </span>
      </span>
    </Link>
  );
}

/** Accesos rápidos del vendedor: lo que más se usa, a un toque. */
export function SellerQuickAccess() {
  return (
    <nav aria-label="Accesos rápidos" className="grid grid-cols-3 gap-2.5 sm:gap-3">
      <Tile href={ROUTES.sellerVentaNueva} label="Nueva venta" hint="Registrar una operación" icon={<PlusIcon size={20} />} primary />
      <Tile href={ROUTES.sellerVentas} label="Mis ventas" hint="Estado de cada venta" icon={<ReceiptIcon size={20} />} />
      <Tile href={ROUTES.sellerComisiones} label="Comisiones" hint="Confirmadas y por cobrar" icon={<PercentIcon size={20} />} />
    </nav>
  );
}
