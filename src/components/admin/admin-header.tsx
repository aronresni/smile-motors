"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { AdminNav, adminSectionLabel } from "@/components/admin/admin-nav";
import { CommandPalette } from "@/components/admin/command-palette";
import { BrandMark } from "@/components/brand/brand-mark";
import { LogOutIcon, MenuIcon, SearchIcon, ShieldIcon, XIcon } from "@/components/ui/icons";
import { LogoutButton } from "@/components/auth/logout-button";
import { NotificationBell } from "@/components/notifications/notification-bell";

interface AdminHeaderProps {
  fullName: string | null;
  email: string | null;
  approvalsCount: number;
  alertsCount: number;
}

function initials(name: string | null, email: string | null): string {
  const base = (name ?? email ?? "A").trim();
  const parts = base.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "A") + (parts[1]?.[0] ?? "")).toUpperCase();
}

/**
 * Cabecera del Admin: contexto de la página, búsqueda global (Ctrl/Cmd + K),
 * identidad + rol ADMIN siempre visible y cierre de sesión. En móvil/tablet
 * abre el drawer de navegación.
 */
export function AdminHeader({ fullName, email, approvalsCount, alertsCount }: AdminHeaderProps) {
  const pathname = usePathname();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLDialogElement>(null);
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setIsMac(/Mac|iPhone|iPad/.test(navigator.platform)), 0);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    const d = drawerRef.current;
    if (!d) return;
    if (drawerOpen && !d.open) d.showModal();
    if (!drawerOpen && d.open) d.close();
  }, [drawerOpen]);

  const section = adminSectionLabel(pathname);

  return (
    <>
      <header
        className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Abrir navegación"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border text-text-secondary transition-colors hover:bg-surface-elevated hover:text-foreground lg:hidden"
          >
            <MenuIcon size={18} />
          </button>

          <div className="min-w-0 flex-1">
            <p className="hidden text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground lg:block">
              Administración
            </p>
            <p className="truncate text-sm font-semibold text-foreground sm:text-base">{section}</p>
          </div>

          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="group hidden h-10 w-full max-w-sm items-center gap-2.5 rounded-xl border border-border-strong bg-surface px-3 text-left text-sm text-muted-foreground transition-colors hover:border-muted-foreground/50 hover:text-text-secondary md:flex"
          >
            <SearchIcon size={16} />
            <span className="flex-1 truncate">Buscar venta, seguimiento, cliente…</span>
            <kbd className="rounded-md border border-border-strong px-1.5 py-0.5 text-[10px] font-semibold">
              {isMac ? "⌘ K" : "Ctrl K"}
            </kbd>
          </button>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label="Buscar"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border text-text-secondary transition-colors hover:bg-surface-elevated hover:text-foreground md:hidden"
          >
            <SearchIcon size={18} />
          </button>

          <div className="flex shrink-0 items-center gap-2.5">
            <NotificationBell variant="admin" />
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-brand/40 bg-brand-soft px-2 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-brand sm:px-2.5"
              aria-label="Rol: administrador"
              title="Estás operando con privilegios de administrador"
            >
              <ShieldIcon size={13} />
              <span className="hidden sm:inline">Admin</span>
            </span>
            <div className="hidden text-right leading-tight xl:block">
              <p className="max-w-[180px] truncate text-sm font-medium text-foreground">{fullName ?? "Administrador"}</p>
              <p className="max-w-[180px] truncate text-[11px] text-muted-foreground">{email}</p>
            </div>
            <span
              aria-hidden="true"
              className="grid h-9 w-9 place-items-center rounded-full border border-border-strong bg-surface-elevated text-xs font-bold text-brand"
            >
              {initials(fullName, email)}
            </span>
            <LogoutButton
              iconOnly
              className="grid h-10 w-10 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-surface-elevated hover:text-foreground"
            >
              <LogOutIcon size={18} />
            </LogoutButton>
          </div>
        </div>
      </header>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />

      {/* Drawer de navegación (móvil / tablet) */}
      <dialog
        ref={drawerRef}
        onClose={() => setDrawerOpen(false)}
        onCancel={(e) => {
          e.preventDefault();
          setDrawerOpen(false);
        }}
        onClick={(e) => {
          if (e.target === drawerRef.current) setDrawerOpen(false);
        }}
        aria-label="Navegación de administración"
        className="theme-dark fixed inset-y-0 left-0 m-0 h-dvh max-h-dvh w-[min(20rem,86vw)] max-w-none border-r border-border-strong bg-surface p-0 text-foreground shadow-2xl animate-slide-in-left backdrop:backdrop-blur-[2px] lg:hidden"
      >
        {drawerOpen && (
          <div className="flex h-full flex-col" style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-4">
              <BrandMark roleLabel="Administración" size={40} />
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Cerrar navegación"
                className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-surface-elevated hover:text-foreground"
              >
                <XIcon size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-4">
              <AdminNav
                approvalsCount={approvalsCount}
                alertsCount={alertsCount}
                onNavigate={() => setDrawerOpen(false)}
              />
            </div>
            <div className="border-t border-border px-4 py-3">
              <p className="truncate text-sm font-medium text-foreground">{fullName ?? "Administrador"}</p>
              <p className="truncate text-xs text-muted-foreground">{email}</p>
              <div className="mt-3">
                <LogoutButton className="flex w-full items-center justify-center gap-2 rounded-xl border border-border-strong px-3 py-2.5 text-sm font-medium text-text-secondary hover:bg-surface-elevated hover:text-foreground">
                  <LogOutIcon size={16} />
                  Cerrar sesión
                </LogoutButton>
              </div>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
