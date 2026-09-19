"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/components/ui/toast";
import { TextAreaField } from "@/components/ui/form-fields";
import { confirmErrorText } from "@/lib/sales/confirm-errors";
import { returnSaleToDraft } from "@/app/(seller)/seller/ventas/[saleId]/sale-actions";

/**
 * Corrección de una venta PENDIENTE por parte de administración. El admin ya
 * NO aprueba PENDING → SOLD (eso lo hace el vendedor cuando los contratos
 * obligatorios están firmados) — solo puede devolverla a borrador si detecta
 * un problema antes de que el vendedor la cierre. Solo se renderiza para
 * `profile.role === "admin"`; la RPC vuelve a validar `is_admin()`.
 */
export function AdminReviewActions({ saleId }: { saleId: string }) {
  const router = useRouter();
  const [returnOpen, setReturnOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitReturn = async () => {
    if (busy) return;
    if (reason.trim().length < 4) {
      setError("Escribe el motivo de la devolución (mínimo 4 caracteres).");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await returnSaleToDraft(saleId, reason.trim());
    if (!res.ok) {
      setError(confirmErrorText(res.code));
      setBusy(false);
      return;
    }
    setReturnOpen(false);
    toast.success("Venta devuelta a borrador.");
    router.refresh();
  };

  return (
    <div className="rounded-2xl border border-warning/30 bg-warning/5 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-warning">
        Venta en revisión
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        El vendedor la marcará como vendida cuando los contratos de
        financiación obligatorios estén firmados. Si detectas un problema
        antes de eso, puedes devolverla a borrador para que la corrija.
      </p>

      <div className="mt-3">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setReturnOpen(true)}
          disabled={busy}
        >
          Devolver a borrador
        </Button>
      </div>

      <Modal
        open={returnOpen}
        onClose={() => !busy && setReturnOpen(false)}
        title="Devolver a borrador"
        description="El vendedor podrá corregir la venta y volver a enviarla a revisión."
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setReturnOpen(false)}
              disabled={busy}
            >
              Cancelar
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => void submitReturn()}
              disabled={busy || reason.trim().length < 4}
            >
              {busy ? "Devolviendo…" : "Devolver a borrador"}
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          <TextAreaField
            label="Motivo de la devolución"
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ej.: Falta el documento del destinatario"
          />
          {error && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}
