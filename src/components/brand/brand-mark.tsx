import Image from "next/image";
import { BRAND } from "@/config/brand";
import { cn } from "@/lib/utils";

/**
 * Logo OFICIAL de Smile Motors (asset real, nunca redibujado). Cuadrado 1:1
 * con `object-contain` → jamás se estira. `size` en px (lado del cuadrado).
 */
export function BrandLogo({
  size = 40,
  className,
  priority = false,
}: {
  size?: number;
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src={BRAND.logo.src}
      alt={BRAND.logo.alt}
      width={size}
      height={size}
      priority={priority}
      sizes={`${size}px`}
      className={cn("shrink-0 select-none object-contain", className)}
      style={{ width: size, height: size }}
      draggable={false}
    />
  );
}

/**
 * Bloque de marca para navegación: logo + "SMILE MOTORS" + etiqueta de
 * contexto opcional (ADMINISTRACIÓN / VENDEDOR). Un solo logo para todos los
 * roles — el rol solo cambia la etiqueta pequeña.
 */
export function BrandMark({
  className,
  roleLabel,
  size = 40,
  priority,
}: {
  className?: string;
  roleLabel?: string;
  size?: number;
  priority?: boolean;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <BrandLogo size={size} priority={priority} />
      <div className="min-w-0 leading-none">
        <p className="truncate text-[15px] font-black tracking-[0.08em] text-foreground">
          <span className="text-brand">SMILE</span> MOTORS
        </p>
        {roleLabel && (
          <p className="mt-1 truncate text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {roleLabel}
          </p>
        )}
      </div>
    </div>
  );
}
