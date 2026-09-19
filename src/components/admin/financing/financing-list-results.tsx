"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/lib/constants";
import { formatBps, feeStrategySummary } from "@/lib/payments/fee-engine";
import { financingActionErrorText } from "@/lib/admin/financing-errors";
import type { AdminProviderListItem } from "@/lib/admin/financing";
import { setProviderActive } from "@/app/(admin)/admin/financieras/actions";

const TYPE_LABEL: Record<string, string> = {
  CARD: "Tarjeta",
  ZELLE: "Zelle",
  FINANCING: "Financiación",
  INTERNAL: "Efectivo / interno",
};

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

function feeCell(item: AdminProviderListItem): string {
  if (item.feeStrategy === "NONE") return "Sin comisión";
  if (item.feeStrategy === "INSTALLMENTS") return "Según plan";
  if (item.flatFeeBps != null) return formatBps(item.flatFeeBps);
  if (item.flatFeeCents != null) return "Cargo fijo";
  return feeStrategySummary({ strategy: item.feeStrategy });
}

function ToggleActiveButton({ item }: { item: AdminProviderListItem }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    if (busy) return;
    const verb = item.isActive ? "desactivar" : "activar";
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
    const res = await setProviderActive(item.providerId, !item.isActive);
    if (!res.ok) setError(financingActionErrorText(res.code));
    setBusy(false);
    router.refresh();
    void verb;
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

function ProviderRow({ item }: { item: AdminProviderListItem }) {
  const isFinancing = item.methodType === "FINANCING";
  return (
    <tr className="border-b last:border-0 border-border/70">
      <td className="px-3 py-2.5 align-top">
        <Link href={`${ROUTES.adminFinancieras}/${item.providerId}`} className="font-medium hover:underline">
          {item.name}
        </Link>
        <p className="text-[11px] text-muted-foreground">{item.legacyId}</p>
      </td>
      <td className="px-3 py-2.5 align-top text-text-secondary">
        {TYPE_LABEL[item.methodType] ?? item.methodType}
      </td>
      <td className="px-3 py-2.5 align-top"><StatusPill active={item.isActive} /></td>
      <td className="px-3 py-2.5 align-top text-text-secondary">{feeCell(item)}</td>
      <td className="px-3 py-2.5 text-right align-top tabular-nums">{isFinancing ? item.planCount : "N/A"}</td>
      <td className="px-3 py-2.5 align-top text-text-secondary">
        {isFinancing ? (item.requiresSignedContract ? "Requiere" : "No requiere") : "N/A"}
      </td>
      <td className="px-3 py-2.5 align-top text-text-secondary">
        {isFinancing && item.onlyFlorida ? "Solo Florida" : "—"}
      </td>
      <td className="px-3 py-2.5 text-right align-top tabular-nums">{item.salesUsingCount}</td>
      <td className="px-3 py-2.5 text-right align-top">
        <div className="flex flex-col items-end gap-1.5">
          <Link
            href={`${ROUTES.adminFinancieras}/${item.providerId}`}
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

function DesktopTable({ items }: { items: AdminProviderListItem[] }) {
  return (
    <div className="hidden overflow-hidden rounded-xl border border-border lg:block">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground border-border bg-surface">
              <th className="px-3 py-2.5 font-medium">Proveedor</th>
              <th className="px-3 py-2.5 font-medium">Tipo</th>
              <th className="px-3 py-2.5 font-medium">Estado</th>
              <th className="px-3 py-2.5 font-medium">Fee</th>
              <th className="px-3 py-2.5 text-right font-medium">Planes</th>
              <th className="px-3 py-2.5 font-medium">Contrato</th>
              <th className="px-3 py-2.5 font-medium">Restricciones</th>
              <th className="px-3 py-2.5 text-right font-medium">Uso</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <ProviderRow key={item.providerId} item={item} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MobileCards({ items }: { items: AdminProviderListItem[] }) {
  return (
    <ul className="space-y-2.5 lg:hidden">
      {items.map((item) => {
        const isFinancing = item.methodType === "FINANCING";
        return (
          <li key={item.providerId} className="rounded-xl border p-4 border-border bg-surface">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Link href={`${ROUTES.adminFinancieras}/${item.providerId}`} className="font-semibold hover:underline">
                  {item.name}
                </Link>
                <p className="text-[11px] text-muted-foreground">{item.legacyId} · {TYPE_LABEL[item.methodType] ?? item.methodType}</p>
              </div>
              <StatusPill active={item.isActive} />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>Fee: <strong className="text-foreground">{feeCell(item)}</strong></span>
              {isFinancing && <span>Planes: <strong className="text-foreground">{item.planCount}</strong></span>}
              <span>Uso: <strong className="text-foreground">{item.salesUsingCount}</strong></span>
            </div>
            {isFinancing && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                {item.requiresSignedContract ? "Requiere contrato" : "Sin contrato"}
                {item.onlyFlorida ? " · Solo Florida" : ""}
              </p>
            )}
            <div className="mt-3 flex items-center justify-between">
              <Link
                href={`${ROUTES.adminFinancieras}/${item.providerId}`}
                className="inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium border-border hover:bg-surface-elevated"
              >
                Ver detalle
              </Link>
              <ToggleActiveButton item={item} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function FinancingListResults({ items }: { items: AdminProviderListItem[] }) {
  return (
    <div>
      <DesktopTable items={items} />
      <MobileCards items={items} />
    </div>
  );
}
