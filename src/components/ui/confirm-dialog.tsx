"use client";

import { useId, useState, type ReactNode } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { AlertTriangleIcon, InfoIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

export type ConfirmResult = { ok: true } | { ok: false; message: string };

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Qué va a pasar — siempre explícito. */
  description?: ReactNode;
  /** Consecuencias concretas, en lista. */
  consequences?: ReactNode[];
  /** Etiqueta del CTA con la acción nombrada ("Marcar como pagada"). */
  confirmLabel: string;
  /** Etiqueta durante la ejecución ("Marcando como pagada…"). */
  pendingLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger" | "warning";
  /** Si se define, exige un motivo con ese mínimo de caracteres. */
  reason?: { label: string; placeholder?: string; minLength?: number; hint?: ReactNode };
  /** Casilla de reconocimiento obligatoria (acciones sensibles). */
  acknowledge?: string;
  children?: ReactNode;
  /** Ejecuta la acción. Devuelve ok o un mensaje de error ya traducido. */
  onConfirm: (reason: string) => Promise<ConfirmResult>;
}

/**
 * Confirmación ÚNICA para acciones con consecuencias (VENDIDA, PAGADA,
 * suspender, desactivar, aprobar/pagar liquidación, corrección
 * administrativa…). Bloquea doble envío, muestra progreso y el error en línea
 * sin cerrar el diálogo.
 */
export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  consequences,
  confirmLabel,
  pendingLabel,
  cancelLabel = "Cancelar",
  tone = "default",
  reason,
  acknowledge,
  children,
  onConfirm,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [ack, setAck] = useState(false);
  const reasonId = useId();

  const min = reason?.minLength ?? 4;
  const reasonOk = !reason || text.trim().length >= min;
  const ackOk = !acknowledge || ack;

  const close = () => {
    if (busy) return;
    setError(null);
    setText("");
    setAck(false);
    onClose();
  };

  const run = async () => {
    if (busy || !reasonOk || !ackOk) return;
    setBusy(true);
    setError(null);
    try {
      const res = await onConfirm(text.trim());
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setText("");
      setAck(false);
      onClose();
    } catch {
      setError("No pudimos completar la acción. Intenta de nuevo.");
    } finally {
      setBusy(false);
    }
  };

  const icon =
    tone === "danger" ? (
      <span className="grid h-8 w-8 place-items-center rounded-full bg-danger-surface text-danger">
        <AlertTriangleIcon size={16} />
      </span>
    ) : tone === "warning" ? (
      <span className="grid h-8 w-8 place-items-center rounded-full bg-warning-soft text-warning">
        <AlertTriangleIcon size={16} />
      </span>
    ) : (
      <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-soft text-brand">
        <InfoIcon size={16} />
      </span>
    );

  return (
    <Modal
      open={open}
      onClose={close}
      title={title}
      description={description}
      icon={icon}
      size={reason || children ? "lg" : "md"}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === "danger" ? "danger-solid" : "primary"}
            onClick={() => void run()}
            loading={busy}
            loadingText={pendingLabel}
            disabled={!reasonOk || !ackOk}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {consequences && consequences.length > 0 && (
          <ul className="space-y-1.5 rounded-xl border border-border bg-surface-muted px-3.5 py-3 text-sm text-text-secondary">
            {consequences.map((c, i) => (
              <li key={i} className="flex gap-2">
                <span aria-hidden="true" className={cn("mt-2 h-1.5 w-1.5 shrink-0 rounded-full", tone === "danger" ? "bg-danger" : "bg-brand")} />
                <span>{c}</span>
              </li>
            ))}
          </ul>
        )}

        {children}

        {reason && (
          <div className="space-y-1.5">
            <label htmlFor={reasonId} className="text-xs font-medium text-text-secondary">
              {reason.label} <span className="text-danger">*</span>
            </label>
            <textarea
              id={reasonId}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={reason.placeholder}
              rows={3}
              className="w-full resize-y rounded-lg border border-border-strong bg-surface px-3.5 py-2.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25"
            />
            <p className="text-[11px] text-muted-foreground">
              {reason.hint ?? `Obligatorio · mínimo ${min} caracteres. Queda registrado en la auditoría.`}
            </p>
          </div>
        )}

        {acknowledge && (
          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5 text-xs text-foreground">
            <input
              type="checkbox"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0"
              style={{ accentColor: "var(--brand)" }}
            />
            <span>{acknowledge}</span>
          </label>
        )}

        {error && (
          <p role="alert" className="rounded-lg border border-danger/30 bg-danger-surface px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
