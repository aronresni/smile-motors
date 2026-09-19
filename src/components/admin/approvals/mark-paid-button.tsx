"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { approvalsErrorText } from "@/lib/admin/approvals-errors";
import { adminMarkSalePaid } from "@/app/(seller)/seller/ventas/[saleId]/sale-actions";
import { toast } from "@/components/ui/toast";

/** Reutiliza `admin_mark_sale_paid` tal cual (mismo Server Action que ya
 * usa la ficha de venta) — nunca otra transición a PAID. */
export function MarkPaidButton({ saleId, saleNumber }: { saleId: string; saleNumber: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await adminMarkSalePaid(saleId);
    if (!res.ok) {
      setError(approvalsErrorText(res.code));
      setBusy(false);
      return;
    }
    setBusy(false);
    setOpen(false);
    toast.success("Venta marcada como pagada.");
    router.refresh();
  };

  return (
    <>
      <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
        Marcar como pagada
      </Button>
      <Modal
        open={open}
        onClose={() => !busy && setOpen(false)}
        title="Marcar como pagada"
        description={`Esta acción registrará la venta ${saleNumber ?? ""} como pagada.`}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={busy}>Cancelar</Button>
            <Button variant="primary" size="sm" onClick={() => void submit()} disabled={busy}>
              {busy ? "Procesando…" : "Confirmar"}
            </Button>
          </>
        }
      >
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </Modal>
    </>
  );
}
