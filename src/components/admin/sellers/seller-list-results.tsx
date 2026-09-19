"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/lib/constants";
import { sellerActionErrorText } from "@/lib/admin/seller-errors";
import type { AdminSellerListItem } from "@/lib/admin/sellers";
import { cancelSellerInvitation, resendSellerInvitation } from "@/app/(admin)/admin/vendedores/actions";
import { StatusBadge } from "@/components/ui/status-badge";

function StatusPill({ status }: { status: string }) {
  return <StatusBadge domain="account" status={status} />;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("es-DO", { dateStyle: "medium" }).format(d);
}

function InvitedRowActions({ sellerId }: { sellerId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resend = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await resendSellerInvitation(sellerId);
    if (!res.ok) setError(sellerActionErrorText(res.code));
    setBusy(false);
    router.refresh();
  };
  const cancel = async () => {
    if (busy) return;
    if (!confirm("¿Cancelar esta invitación? La cuenta quedará deshabilitada.")) return;
    setBusy(true);
    setError(null);
    const res = await cancelSellerInvitation(sellerId);
    if (!res.ok) setError(sellerActionErrorText(res.code));
    setBusy(false);
    router.refresh();
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => void resend()}
          disabled={busy}
          className="rounded-md border px-2 py-1 text-[11px] font-medium disabled:opacity-50 border-border hover:bg-surface-elevated"
        >
          Reenviar
        </button>
        <button
          type="button"
          onClick={() => void cancel()}
          disabled={busy}
          className="rounded-md border px-2 py-1 text-[11px] font-medium disabled:opacity-50 border-danger/30 text-danger hover:bg-danger/10"
        >
          Cancelar
        </button>
      </div>
      {error && <p className="max-w-[160px] text-right text-[10px] text-danger">{error}</p>}
    </div>
  );
}

function SellerRow({ item }: { item: AdminSellerListItem }) {
  return (
    <tr className="border-b last:border-0 border-border/70">
      <td className="px-3 py-2.5 align-top">
        <Link href={`${ROUTES.adminVendedores}/${item.sellerId}`} className="font-medium hover:underline">
          {item.fullName ?? "Sin nombre"}
        </Link>
      </td>
      <td className="px-3 py-2.5 align-top text-text-secondary">{item.email ?? "—"}</td>
      <td className="px-3 py-2.5 align-top text-text-secondary">{item.phone ?? "—"}</td>
      <td className="px-3 py-2.5 align-top"><StatusPill status={item.accountStatus} /></td>
      <td className="px-3 py-2.5 align-top text-muted-foreground">{formatDate(item.createdAt)}</td>
      <td className="px-3 py-2.5 text-right align-top tabular-nums">{item.soldCount}</td>
      <td className="px-3 py-2.5 text-right align-top tabular-nums">{item.paidCount}</td>
      <td className="px-3 py-2.5 align-top text-muted-foreground">{formatDate(item.lastActivityAt)}</td>
      <td className="px-3 py-2.5 text-right align-top">
        {item.accountStatus === "INVITED" ? (
          <InvitedRowActions sellerId={item.sellerId} />
        ) : (
          <Link
            href={`${ROUTES.adminVendedores}/${item.sellerId}`}
            className="inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium border-border hover:bg-surface-elevated"
          >
            Ver
          </Link>
        )}
      </td>
    </tr>
  );
}

function DesktopTable({ items }: { items: AdminSellerListItem[] }) {
  return (
    <div className="hidden overflow-hidden rounded-xl border border-border lg:block">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground border-border bg-surface">
              <th className="px-3 py-2.5 font-medium">Vendedor</th>
              <th className="px-3 py-2.5 font-medium">Email</th>
              <th className="px-3 py-2.5 font-medium">Teléfono</th>
              <th className="px-3 py-2.5 font-medium">Estado</th>
              <th className="px-3 py-2.5 font-medium">Fecha de alta</th>
              <th className="px-3 py-2.5 text-right font-medium">Vendidas</th>
              <th className="px-3 py-2.5 text-right font-medium">Pagadas</th>
              <th className="px-3 py-2.5 font-medium">Última actividad</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <SellerRow key={item.sellerId} item={item} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MobileCards({ items }: { items: AdminSellerListItem[] }) {
  return (
    <ul className="space-y-2.5 lg:hidden">
      {items.map((item) => (
        <li key={item.sellerId} className="rounded-xl border p-4 border-border bg-surface">
          <div className="flex items-start justify-between gap-3">
            <Link href={`${ROUTES.adminVendedores}/${item.sellerId}`} className="font-semibold hover:underline">
              {item.fullName ?? "Sin nombre"}
            </Link>
            <StatusPill status={item.accountStatus} />
          </div>
          <p className="mt-1 text-sm text-text-secondary">{item.email ?? "—"}</p>
          {item.phone && <p className="text-xs text-muted-foreground">{item.phone}</p>}
          <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
            <span>Vendidas: <strong className="text-foreground">{item.soldCount}</strong></span>
            <span>Pagadas: <strong className="text-foreground">{item.paidCount}</strong></span>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">Alta: {formatDate(item.createdAt)}</p>
          <div className="mt-3">
            {item.accountStatus === "INVITED" ? (
              <InvitedRowActions sellerId={item.sellerId} />
            ) : (
              <Link
                href={`${ROUTES.adminVendedores}/${item.sellerId}`}
                className="inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium border-border hover:bg-surface-elevated"
              >
                Ver detalle
              </Link>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function SellerListResults({ items }: { items: AdminSellerListItem[] }) {
  return (
    <div>
      <DesktopTable items={items} />
      <MobileCards items={items} />
    </div>
  );
}
