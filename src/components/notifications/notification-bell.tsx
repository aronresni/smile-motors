"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { ROUTES } from "@/lib/constants";
import { BellIcon, XIcon } from "@/components/ui/icons";
import { useNotifications } from "@/components/notifications/notifications-provider";
import { NotificationRow } from "@/components/notifications/notification-row";
import type { NotificationItem } from "@/lib/notifications/types";

/**
 * Campana con contador de no leídas. Al abrirla muestra las recientes:
 *  · escritorio: panel desplegable anclado a la campana;
 *  · móvil: panel a pantalla completa (se monta en un portal porque el
 *    header usa `backdrop-blur`, que rompe `position: fixed` en sus hijos).
 */
export function NotificationBell({ variant }: { variant: "admin" | "seller" }) {
  const { unread, recent, loadingRecent, loadRecent, open, markAllRead, zone, live } = useNotifications();
  const [isOpen, setIsOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  const [isDesktop, setIsDesktop] = useState(false);
  const [mounted, setMounted] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const allHref = zone === "admin" ? ROUTES.adminNotificaciones : ROUTES.sellerNotificaciones;

  useEffect(() => {
    const t = window.setTimeout(() => setMounted(true), 0);
    return () => window.clearTimeout(t);
  }, []);

  const place = useCallback(() => {
    setIsDesktop(window.matchMedia("(min-width: 640px)").matches);
    const r = buttonRef.current?.getBoundingClientRect();
    if (r) setAnchor({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) });
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [isOpen, place]);

  // Cerrar al navegar.
  useEffect(() => {
    const t = window.setTimeout(() => setIsOpen(false), 0);
    return () => window.clearTimeout(t);
  }, [pathname]);

  // Escape y clic fuera.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || buttonRef.current?.contains(t)) return;
      setIsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [isOpen]);

  const toggle = () => {
    const next = !isOpen;
    if (next) {
      place();
      void loadRecent();
    }
    setIsOpen(next);
  };

  const onOpenItem = (item: NotificationItem) => {
    setIsOpen(false);
    void open(item);
  };

  const label = unread > 0 ? `Notificaciones: ${unread} sin leer` : "Notificaciones";
  const badge = unread > 99 ? "99+" : String(unread);

  const panel = (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Notificaciones"
      data-testid="notifications-panel"
      className={cn(
        "fixed inset-0 z-[90] flex flex-col bg-background text-foreground",
        "sm:inset-auto sm:max-h-[min(70vh,560px)] sm:w-[380px] sm:rounded-2xl sm:border sm:border-border-strong sm:bg-surface sm:shadow-2xl sm:shadow-black/60",
      )}
      style={isDesktop && anchor ? { top: anchor.top, right: anchor.right } : undefined}
    >
      <div
        className="flex items-center justify-between gap-2 border-b border-border px-4 py-3"
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-text-secondary">Notificaciones</p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void markAllRead()}
            disabled={unread === 0}
            className="rounded-lg px-2 py-1 text-xs font-medium text-brand hover:bg-surface-muted disabled:cursor-default disabled:text-muted-foreground disabled:hover:bg-transparent"
          >
            Marcar todas como leídas
          </button>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            aria-label="Cerrar notificaciones"
            className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-surface-muted hover:text-foreground sm:hidden"
          >
            <XIcon size={18} />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {recent === null && loadingRecent ? (
          <div className="space-y-3 p-4" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-lg bg-surface-muted" />
            ))}
          </div>
        ) : recent && recent.length > 0 ? (
          <ul className="divide-y divide-border">
            {recent.map((item) => (
              <li key={item.id}>
                <NotificationRow item={item} onOpen={onOpenItem} compact />
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">No tienes notificaciones.</p>
        )}
      </div>

      <div
        className="border-t border-border p-2"
        style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
      >
        <Link
          href={allHref}
          onClick={() => setIsOpen(false)}
          className="flex h-10 w-full items-center justify-center rounded-xl text-xs font-bold uppercase tracking-[0.14em] text-foreground hover:bg-surface-muted"
        >
          Ver todas
        </Link>
      </div>
    </div>
  );

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        data-testid="notification-bell"
        data-live={live ? "true" : "false"}
        className={cn(
          "relative grid shrink-0 place-items-center border text-text-secondary transition-colors hover:text-foreground",
          variant === "admin"
            ? "h-10 w-10 rounded-xl border-border hover:bg-surface-elevated"
            : "h-11 w-11 rounded-2xl border-border-strong bg-surface-elevated hover:border-brand/50",
          isOpen && "border-brand/60 text-foreground",
        )}
      >
        <BellIcon size={variant === "admin" ? 18 : 20} />
        {unread > 0 && (
          <span
            data-testid="notification-badge"
            className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1 text-[10px] font-bold leading-none text-brand-foreground ring-2 ring-background"
          >
            {badge}
          </span>
        )}
      </button>
      {mounted && isOpen && createPortal(panel, document.body)}
    </>
  );
}
