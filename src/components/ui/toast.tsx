"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { AlertCircleIcon, AlertTriangleIcon, BellIcon, CheckCircleIcon, InfoIcon, XIcon } from "@/components/ui/icons";

/**
 * Notificaciones efímeras (toasts) ÚNICAS de la app. Store a nivel de módulo
 * (sin contexto) → `toast.success("Venta marcada como pagada.")` se puede
 * llamar desde cualquier componente cliente, incluso justo antes de un
 * `router.push()` — `<Toaster />` vive en el layout raíz y sobrevive a la
 * navegación.
 */
type Tone = "success" | "error" | "info" | "warning" | "notice";
export interface ToastItem {
  id: number;
  tone: Tone;
  title: string;
  description?: string;
  /** Ruta interna: al tocar el toast se navega ahí (notificaciones). */
  href?: string;
}

let items: ToastItem[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const EMPTY: ToastItem[] = [];

function emit() {
  for (const l of listeners) l();
}
function push(tone: Tone, title: string, description?: string, href?: string) {
  const id = ++seq;
  items = [...items.slice(-3), { id, tone, title, description, href }];
  emit();
  return id;
}
function dismiss(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

export const toast = {
  success: (title: string, description?: string) => push("success", title, description),
  error: (title: string, description?: string) => push("error", title, description),
  info: (title: string, description?: string) => push("info", title, description),
  warning: (title: string, description?: string) => push("warning", title, description),
  /** Notificación en vivo: pequeña, descartable y, si trae ruta, navegable. */
  notify: (title: string, description?: string, href?: string) => push("notice", title, description, href),
  dismiss,
};

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const TONE: Record<Tone, { icon: typeof InfoIcon; className: string }> = {
  success: { icon: CheckCircleIcon, className: "text-success" },
  error: { icon: AlertCircleIcon, className: "text-danger" },
  warning: { icon: AlertTriangleIcon, className: "text-warning" },
  info: { icon: InfoIcon, className: "text-brand" },
  notice: { icon: BellIcon, className: "text-brand" },
};

function ToastCard({ item }: { item: ToastItem }) {
  const router = useRouter();
  useEffect(() => {
    const ms = item.tone === "error" ? 7000 : item.tone === "notice" ? 6500 : 4500;
    const t = window.setTimeout(() => dismiss(item.id), ms);
    return () => window.clearTimeout(t);
  }, [item.id, item.tone]);

  const { icon: Icon, className } = TONE[item.tone];
  return (
    <li
      role={item.tone === "error" ? "alert" : "status"}
      className="pointer-events-auto flex w-full items-start gap-3 rounded-xl border border-border-strong bg-surface-elevated px-3.5 py-3 shadow-xl shadow-black/50 animate-pop-in"
    >
      <Icon size={18} className={cn("mt-0.5 shrink-0", className)} />
      {item.href ? (
        <button
          type="button"
          onClick={() => {
            dismiss(item.id);
            router.push(item.href!);
          }}
          className="min-w-0 flex-1 text-left"
        >
          <p className="text-sm font-semibold text-foreground">{item.title}</p>
          {item.description && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{item.description}</p>}
        </button>
      ) : (
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{item.title}</p>
          {item.description && <p className="mt-0.5 text-xs text-muted-foreground">{item.description}</p>}
        </div>
      )}
      <button
        type="button"
        onClick={() => dismiss(item.id)}
        aria-label="Cerrar notificación"
        className="-mr-1 grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-surface-muted hover:text-foreground"
      >
        <XIcon size={14} />
      </button>
    </li>
  );
}

export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => items, () => EMPTY);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex justify-center px-3 sm:inset-x-auto sm:bottom-5 sm:right-5 sm:top-auto sm:justify-end sm:px-0"
      style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
    >
      <ol className="flex w-full max-w-sm flex-col gap-2">
        {list.map((t) => (
          <ToastCard key={t.id} item={t} />
        ))}
      </ol>
    </div>
  );
}
