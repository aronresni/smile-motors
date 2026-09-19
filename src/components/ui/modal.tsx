"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { XIcon } from "@/components/ui/icons";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  size?: "md" | "lg" | "xl";
  children: ReactNode;
  footer?: ReactNode;
  /** Icono/acento opcional junto al título. */
  icon?: ReactNode;
}

/**
 * Diálogo modal accesible sobre `<dialog>` nativo (foco atrapado, ESC cierra,
 * backdrop). Cabe siempre en el viewport (`dvh`, scroll interno) y en móvil
 * se ancla abajo como hoja para que el CTA quede al alcance del pulgar.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  size = "md",
  children,
  footer,
  icon,
}: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className={cn(
        "theme-dark fixed inset-x-0 bottom-0 mx-auto mb-0 mt-auto w-full max-w-full rounded-t-2xl border border-border-strong bg-surface p-0 text-foreground shadow-2xl shadow-black/60",
        "sm:inset-0 sm:m-auto sm:w-[calc(100vw-2rem)] sm:rounded-2xl",
        "backdrop:backdrop-blur-[2px]",
        size === "md" && "sm:max-w-md",
        size === "lg" && "sm:max-w-lg",
        size === "xl" && "sm:max-w-2xl",
      )}
    >
      {open && (
        <div className="flex max-h-[88dvh] flex-col" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
          <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3.5 sm:px-5">
            <div className="flex min-w-0 items-start gap-2.5">
              {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-foreground sm:text-base">{title}</h2>
                {description && (
                  <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground sm:text-[13px]">{description}</div>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-elevated hover:text-foreground"
            >
              <XIcon size={16} />
            </button>
          </div>

          <div className="overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">{children}</div>

          {footer && (
            <div className="flex flex-col-reverse gap-2 border-t border-border px-4 py-3 sm:flex-row sm:flex-wrap sm:justify-end sm:px-5 [&>*]:w-full sm:[&>*]:w-auto">
              {footer}
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}
