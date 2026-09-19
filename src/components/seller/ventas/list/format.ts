import type { SellerSaleListItem } from "@/lib/seller/sales-list";

/** `yyyy-mm-dd` → `dd/mm/aaaa` (sin saltos de zona: se parsea en UTC). */
export function formatSaleListDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  return `${d}/${mo}/${y}`;
}

/** ISO datetime → `dd/mm/aaaa` para `sold_at` / `paid_at`. */
export function formatSaleListDateTime(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("es-DO", { dateStyle: "medium" }).format(date);
}

export interface UnitsSummary {
  /** Nombres de modelo distintos, en orden de aparición. */
  names: string[];
  /** Cuántos modelos distintos quedaron fuera de `names`. */
  overflow: number;
}

/**
 * Representación compacta de las unidades de una venta.
 * Colapsa por nombre de modelo y limita a `max` etiquetas ("+N más").
 */
export function summarizeUnits(
  item: Pick<SellerSaleListItem, "units" | "unitCount">,
  max = 2,
): UnitsSummary {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const u of item.units) {
    const name = (u.productName || "").trim() || "Sin modelo";
    if (seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  const distinct = names.length;
  if (distinct <= max) {
    return { names, overflow: 0 };
  }
  return { names: names.slice(0, max), overflow: distinct - max };
}

/** Códigos de seguimiento presentes (solo ventas confirmadas los tienen). */
export function trackingCodes(item: SellerSaleListItem): string[] {
  return item.units
    .map((u) => u.trackingCode)
    .filter((c): c is string => Boolean(c));
}

/**
 * Nota de cobro para una venta VENDIDA (SOLD) — el estado de cobro es
 * SEPARADO del estado comercial, y se calcula EN VIVO (`collectionStatus`,
 * no la foto que guardó el admin al revisar el cierre). `null` para
 * cualquier otro estado (DRAFT/PENDING no tienen cobro).
 */
export function settlementNote(
  item: Pick<SellerSaleListItem, "status" | "collectionStatus">,
): string | null {
  if (item.status !== "SOLD") return null;
  if (item.collectionStatus === "READY_TO_PAY") return "Cobro completo";
  return "Pendiente a cobrar";
}

/** Fecha de pago para una venta PAGADA — SIEMPRE `paid_at`, nunca
 * `sale_date`/`sold_at`/`updated_at`. */
export function paidDateLabel(item: Pick<SellerSaleListItem, "status" | "paidAt">): string | null {
  if (item.status !== "PAID" || !item.paidAt) return null;
  const d = new Date(item.paidAt);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("es-DO", { dateStyle: "medium" }).format(d);
}
