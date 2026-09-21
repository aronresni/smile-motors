import Image from "next/image";
import { cn } from "@/lib/utils";
import { ImageIcon } from "@/components/ui/icons";

/**
 * Imagen de catálogo. Mismo tratamiento que el gestor de imágenes del admin
 * (`next/image` con `fill` + `unoptimized`, bucket público `product-images`).
 *
 * Hoy la mayoría de los productos todavía no tiene archivo subido (las filas
 * heredadas solo guardan la ruta antigua), así que el marcador tiene que ser
 * digno: se muestra en cuanto un administrador sube la foto.
 */
export function ProductThumb({
  src,
  alt,
  sizes,
  className,
  priority,
}: {
  src: string | null;
  alt: string;
  sizes: string;
  className?: string;
  priority?: boolean;
}) {
  return (
    <div className={cn("relative overflow-hidden bg-surface-muted", className)}>
      {src ? (
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          className="object-cover"
          unoptimized
          priority={priority}
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-[radial-gradient(circle_at_50%_30%,rgba(255,255,255,0.06),transparent_70%)] text-muted-foreground">
          <ImageIcon size={22} />
          <span className="text-[10px] uppercase tracking-[0.14em]">Sin foto</span>
        </div>
      )}
    </div>
  );
}
