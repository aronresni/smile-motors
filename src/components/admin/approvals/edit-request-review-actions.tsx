"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { TextAreaField } from "@/components/ui/form-fields";
import { approvalsErrorText } from "@/lib/admin/approvals-errors";
import {
  approveSaleEditRequest,
  rejectSaleEditRequest,
} from "@/app/(admin)/admin/aprobaciones/actions";
import { toast } from "@/components/ui/toast";

export function EditRequestReviewActions({
  requestId,
  saleId,
  hasConflict,
}: {
  requestId: string;
  saleId: string;
  hasConflict: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reviewNote, setReviewNote] = useState("");

  const approve = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await approveSaleEditRequest(requestId, saleId);
    if (!res.ok) {
      setError(approvalsErrorText(res.code, res.detail));
      setBusy(false);
      return;
    }
    setBusy(false);
    toast.success("Edición aprobada y aplicada a la venta.");
    router.refresh();
  };

  const reject = async () => {
    if (busy) return;
    if (reviewNote.trim().length < 4) {
      setError("Describe el motivo del rechazo (mínimo 4 caracteres).");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await rejectSaleEditRequest(requestId, saleId, reviewNote.trim());
    if (!res.ok) {
      setError(approvalsErrorText(res.code));
      setBusy(false);
      return;
    }
    setBusy(false);
    setRejectOpen(false);
    toast.success("Solicitud de edición rechazada.");
    router.refresh();
  };

  return (
    <div className="space-y-2">
      {hasConflict && (
        <p role="alert" className="rounded-lg border border-danger/30 bg-danger-surface px-3.5 py-2.5 text-sm text-danger">
          La venta cambió desde que se solicitó esta edición. Revisa nuevamente.
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-danger/30 bg-danger-surface px-3.5 py-2.5 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button variant="danger" size="sm" onClick={() => setRejectOpen(true)} disabled={busy}>
          Rechazar
        </Button>
        <Button variant="primary" size="sm" onClick={() => void approve()} disabled={busy}>
          {busy ? "Procesando…" : "Aprobar cambios"}
        </Button>
      </div>

      <Modal
        open={rejectOpen}
        onClose={() => !busy && setRejectOpen(false)}
        title="Rechazar solicitud de edición"
        description="La venta no se modifica. El vendedor verá este motivo."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setRejectOpen(false)} disabled={busy}>Cancelar</Button>
            <Button variant="danger" size="sm" onClick={() => void reject()} disabled={busy}>
              {busy ? "Procesando…" : "Rechazar"}
            </Button>
          </>
        }
      >
        <TextAreaField
          label="Motivo del rechazo"
          required
          value={reviewNote}
          onChange={(e) => setReviewNote(e.target.value)}
          placeholder="Ej.: El precio no coincide con el contrato."
        />
        {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
      </Modal>
    </div>
  );
}
