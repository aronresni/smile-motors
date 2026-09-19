"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/lib/constants";
import { formatCents } from "@/lib/money";
import { isPricingConfigured } from "@/lib/commission";
import { productActionErrorText } from "@/lib/admin/product-errors";
import type { AdminProductListItem } from "@/lib/admin/products";
import { setProductActive } from "@/app/(admin)/admin/productos/actions";

function StatusPill({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
        active
          ? "border-success/30 bg-success/10 text-success"
          : "border-border bg-surface-muted text-muted-foreground"
      }`}
    >
      {active ? "Activo" : "Inactivo"}
    </span>
  );
}

function priceCell(item: AdminProductListItem): string {
  const cents = item.cubaTotalCents || item.basePriceCents;
  return cents ? formatCents(cents) : "—";
}

/** Precio fijo de venta + comisión fija: lo que usan las ventas nuevas. */
function CommissionCell({ item }: { item: AdminProductListItem }) {
  const price = item.defaultReferencePriceCents;
  const commission = item.defaultBaseCommissionCents;
  if (!isPricingConfigured(price, commission)) {
    return <span className="text-warning">Sin configurar</span>;
  }
  return (
    <span className="tabular-nums">
      Precio fijo {formatCents(price)} <span className="text-muted-foreground">· comisión {formatCents(commission!)}</span>
    </span>
  );
}

function ToggleActiveButton({ item }: { item: AdminProductListItem }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    if (busy) return;
    if (
      !confirm(
        item.isActive
          ? `¿Desactivar "${item.name}"? Dejará de ser seleccionable en ventas nuevas; las ventas existentes no se ven afectadas.`
          : `¿Activar "${item.name}"? Volverá a ser seleccionable en ventas nuevas.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    const res = await setProductActive(item.productId, !item.isActive);
    if (!res.ok) setError(productActionErrorText(res.code));
    setBusy(false);
    router.refresh();
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={busy}
        className={`rounded-md border px-2 py-1 text-[11px] font-medium disabled:opacity-50 ${
          item.isActive
            ? "border-danger/30 text-danger hover:bg-danger/10"
            : "border-border hover:bg-surface-elevated"
        }`}
      >
        {item.isActive ? "Desactivar" : "Activar"}
      </button>
      {error && <p className="max-w-[160px] text-right text-[10px] text-danger">{error}</p>}
    </div>
  );
}

function ProductRow({ item }: { item: AdminProductListItem }) {
  return (
    <tr className="border-b last:border-0 border-border/70">
      <td className="px-3 py-2.5 align-top">
        <Link href={`${ROUTES.adminProductos}/${item.productId}`} className="font-medium hover:underline">
          {item.name}
        </Link>
        {item.legacyId && <p className="text-[11px] text-muted-foreground">{item.legacyId}</p>}
      </td>
      <td className="px-3 py-2.5 align-top text-text-secondary">{item.brand || "—"}</td>
      <td className="px-3 py-2.5 align-top text-text-secondary">{item.category || "—"}</td>
      <td className="px-3 py-2.5 text-right align-top tabular-nums">{item.variantCount}</td>
      <td className="px-3 py-2.5 align-top tabular-nums text-text-secondary">{priceCell(item)}</td>
      <td className="px-3 py-2.5 align-top"><StatusPill active={item.isActive} /></td>
      <td className="px-3 py-2.5 align-top text-text-secondary"><CommissionCell item={item} /></td>
      <td className="px-3 py-2.5 text-right align-top">
        <div className="flex flex-col items-end gap-1.5">
          <Link
            href={`${ROUTES.adminProductos}/${item.productId}`}
            className="inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium border-border hover:bg-surface-elevated"
          >
            Ver
          </Link>
          <ToggleActiveButton item={item} />
        </div>
      </td>
    </tr>
  );
}

function DesktopTable({ items }: { items: AdminProductListItem[] }) {
  return (
    <div className="hidden overflow-hidden rounded-xl border border-border lg:block">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground border-border bg-surface">
              <th className="px-3 py-2.5 font-medium">Producto</th>
              <th className="px-3 py-2.5 font-medium">Marca</th>
              <th className="px-3 py-2.5 font-medium">Categoría</th>
              <th className="px-3 py-2.5 text-right font-medium">Variantes</th>
              <th className="px-3 py-2.5 font-medium">Precio de catálogo</th>
              <th className="px-3 py-2.5 font-medium">Estado</th>
              <th className="px-3 py-2.5 font-medium">Precio fijo y comisión</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <ProductRow key={item.productId} item={item} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MobileCards({ items }: { items: AdminProductListItem[] }) {
  return (
    <ul className="space-y-2.5 lg:hidden">
      {items.map((item) => (
        <li key={item.productId} className="rounded-xl border p-4 border-border bg-surface">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Link href={`${ROUTES.adminProductos}/${item.productId}`} className="font-semibold hover:underline">
                {item.name}
              </Link>
              <p className="text-[11px] text-muted-foreground">{item.brand || "—"} · {item.category || "—"}</p>
            </div>
            <StatusPill active={item.isActive} />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Precio de catálogo: <strong className="text-foreground">{priceCell(item)}</strong></span>
            <span>Variantes: <strong className="text-foreground">{item.variantCount}</strong></span>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">Precio fijo y comisión: <CommissionCell item={item} /></p>
          <div className="mt-3 flex items-center justify-between">
            <Link
              href={`${ROUTES.adminProductos}/${item.productId}`}
              className="inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium border-border hover:bg-surface-elevated"
            >
              Ver detalle
            </Link>
            <ToggleActiveButton item={item} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ProductListResults({ items }: { items: AdminProductListItem[] }) {
  return (
    <div>
      <DesktopTable items={items} />
      <MobileCards items={items} />
    </div>
  );
}
