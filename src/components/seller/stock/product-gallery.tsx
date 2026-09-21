"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { ProductThumb } from "@/components/seller/stock/product-thumb";

/** Galería del producto. Con una sola imagen (o ninguna) no muestra miniaturas. */
export function ProductGallery({
  images,
  alt,
}: {
  images: string[];
  alt: string;
}) {
  const [index, setIndex] = useState(0);
  const current = images[index] ?? images[0] ?? null;

  return (
    <div className="space-y-2">
      <ProductThumb
        src={current}
        alt={alt}
        sizes="(min-width: 1024px) 520px, 92vw"
        // Sin foto no tiene sentido reservar media pantalla para un marcador.
        className={
          current
            ? "aspect-[4/3] w-full rounded-2xl border border-border"
            : "h-36 w-full rounded-2xl border border-dashed border-border"
        }
        priority
      />
      {images.length > 1 && (
        <ul className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {images.map((src, i) => (
            <li key={src}>
              <button
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Ver imagen ${i + 1} de ${images.length}`}
                aria-current={i === index ? "true" : undefined}
                className={cn(
                  "block overflow-hidden rounded-xl border transition-colors",
                  i === index ? "border-brand" : "border-border hover:border-border-strong",
                )}
              >
                <ProductThumb
                  src={src}
                  alt=""
                  sizes="72px"
                  className="h-16 w-20"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
