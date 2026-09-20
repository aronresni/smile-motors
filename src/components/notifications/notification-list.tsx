"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useNotifications } from "@/components/notifications/notifications-provider";
import { NotificationRow } from "@/components/notifications/notification-row";
import type { NotificationItem } from "@/lib/notifications/types";

/**
 * Página completa de notificaciones (admin y vendedor). La paginación y el
 * filtro son de servidor (querystring); al llegar una notificación en vivo se
 * refresca la página para que aparezca sin recargar a mano.
 */
export function NotificationList({
  basePath,
  items,
  page,
  pageCount,
  total,
  unreadOnly,
}: {
  basePath: string;
  items: NotificationItem[];
  page: number;
  pageCount: number;
  total: number;
  unreadOnly: boolean;
}) {
  const router = useRouter();
  const { unread, open, markAllRead, version } = useNotifications();
  const firstVersion = useRef(version);

  useEffect(() => {
    if (version !== firstVersion.current) router.refresh();
  }, [version, router]);

  const hrefFor = (p: number, onlyUnread = unreadOnly) => {
    const qs = new URLSearchParams();
    if (onlyUnread) qs.set("filtro", "no-leidas");
    if (p > 1) qs.set("pagina", String(p));
    const s = qs.toString();
    return s ? `${basePath}?${s}` : basePath;
  };

  const tab = (active: boolean) =>
    cn(
      "inline-flex h-9 items-center rounded-lg px-3 text-xs font-semibold transition-colors",
      active ? "bg-surface-elevated text-foreground" : "text-muted-foreground hover:text-foreground",
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Filtro" className="flex gap-1 rounded-xl border border-border p-1">
          <Link href={hrefFor(1, false)} className={tab(!unreadOnly)} aria-current={!unreadOnly ? "page" : undefined}>
            Todas
          </Link>
          <Link href={hrefFor(1, true)} className={tab(unreadOnly)} aria-current={unreadOnly ? "page" : undefined}>
            No leídas{unread > 0 ? ` · ${unread}` : ""}
          </Link>
        </nav>
        <button
          type="button"
          onClick={() => void markAllRead()}
          disabled={unread === 0}
          className="inline-flex h-9 items-center rounded-lg border border-border-strong px-3 text-xs font-semibold uppercase tracking-[0.12em] text-foreground hover:border-brand/60 disabled:cursor-default disabled:opacity-40 disabled:hover:border-border-strong"
        >
          Marcar todas como leídas
        </button>
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border px-6 py-14 text-center">
          <p className="text-sm font-medium text-foreground">
            {unreadOnly ? "No tienes notificaciones sin leer." : "Todavía no tienes notificaciones."}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Aquí aparecerán los avisos sobre ventas, contratos, ediciones y liquidaciones.
          </p>
        </div>
      ) : (
        <ul className="space-y-2" data-testid="notification-list">
          {items.map((item) => (
            <li key={item.id}>
              <NotificationRow item={item} onOpen={(it) => void open(it)} />
            </li>
          ))}
        </ul>
      )}

      {pageCount > 1 && (
        <nav aria-label="Paginación" className="flex items-center justify-between gap-3 pt-2 text-xs text-muted-foreground">
          <span>
            Página {page} de {pageCount} · {total} notificaciones
          </span>
          <span className="flex gap-2">
            {page > 1 ? (
              <Link href={hrefFor(page - 1)} className="rounded-lg border border-border px-3 py-1.5 font-medium text-foreground hover:bg-surface-muted">
                Anterior
              </Link>
            ) : null}
            {page < pageCount ? (
              <Link href={hrefFor(page + 1)} className="rounded-lg border border-border px-3 py-1.5 font-medium text-foreground hover:bg-surface-muted">
                Siguiente
              </Link>
            ) : null}
          </span>
        </nav>
      )}
    </div>
  );
}
