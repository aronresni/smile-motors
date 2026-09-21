import { cn } from "@/lib/utils";
import type { StockVariant } from "@/lib/seller/stock";

/**
 * COLORES DISPONIBLES — nunca cantidades.
 *
 * El catálogo ya no representa unidades físicas, así que aquí no hay (ni puede
 * haber) un número junto al color: solo se pinta el color de las variantes
 * ACTIVAS del producto.
 */

/** Colores reales del catálogo, en español y en inglés (el legado mezcla). */
const SWATCHES: Record<string, string> = {
  negro: "#111113",
  black: "#111113",
  blanco: "#f4f4f5",
  white: "#f4f4f5",
  rojo: "#dc2626",
  red: "#dc2626",
  azul: "#2563eb",
  blue: "#2563eb",
  celeste: "#38bdf8",
  verde: "#16a34a",
  green: "#16a34a",
  gris: "#9ca3af",
  gray: "#9ca3af",
  grey: "#9ca3af",
  plata: "#c0c4cc",
  silver: "#c0c4cc",
  amarillo: "#facc15",
  yellow: "#facc15",
  naranja: "#f97316",
  orange: "#f97316",
  violeta: "#7c3aed",
  morado: "#7c3aed",
  purple: "#7c3aed",
  rosa: "#ec4899",
  pink: "#ec4899",
  dorado: "#d4af37",
  gold: "#d4af37",
  marron: "#78350f",
  brown: "#78350f",
  vino: "#7f1d1d",
  beige: "#e7dcc3",
};

function normalize(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** Color de muestra, o `null` si la etiqueta no es un color reconocible. */
export function swatchFor(label: string): string | null {
  return SWATCHES[normalize(label)] ?? null;
}

export function VariantDots({
  variants,
  className,
  showLabels = false,
}: {
  variants: StockVariant[];
  className?: string;
  showLabels?: boolean;
}) {
  if (variants.length === 0) return null;

  return (
    <ul className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {variants.map((v) => {
        const color = swatchFor(v.label);
        return (
          <li
            key={v.id}
            className={cn(
              "flex items-center gap-1.5",
              showLabels
                ? "rounded-full border border-border bg-surface-muted py-1 pl-1.5 pr-2.5"
                : "",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "h-3.5 w-3.5 shrink-0 rounded-full border",
                color ? "border-white/25" : "border-dashed border-muted-foreground/60",
              )}
              style={color ? { backgroundColor: color } : undefined}
            />
            {showLabels ? (
              <span className="text-[11px] font-medium capitalize text-text-secondary">
                {v.label.toLowerCase()}
              </span>
            ) : (
              <span className="sr-only">{v.label}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
