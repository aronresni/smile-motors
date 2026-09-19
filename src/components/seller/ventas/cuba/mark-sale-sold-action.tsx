"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { confirmErrorText } from "@/lib/sales/confirm-errors";
import { markSaleSold } from "@/app/(seller)/seller/ventas/[saleId]/sale-actions";
import { toast } from "@/components/ui/toast";

/**
 * Acción del VENDEDOR para cerrar comercialmente una venta PENDIENTE
 * (PENDING → SOLD). Bloqueada mientras algún contrato de financiación
 * OBLIGATORIO no esté firmado — la RPC vuelve a verificarlo server-side
 * contra los contratos reales, nunca confía en este cálculo del cliente.
 */
export function MarkSaleSoldAction({
  saleId,
  unsignedRequiredProviders,
}: {
  saleId: string;
  unsignedRequiredProviders: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unsigned, setUnsigned] = useState<string[]>(unsignedRequiredProviders);

  const blocked = unsigned.length > 0;

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await markSaleSold(saleId);
    if (!res.ok) {
      if (res.code === "CONTRACT_UNSIGNED" && res.providers) {
        setUnsigned(res.providers);
        setError(
          `Falta firmar el contrato de ${res.providers.join(", ")}.`,
        );
      } else {
        setError(confirmErrorText(res.code));
      }
      setBusy(false);
      return;
    }
    setOpen(false);
    toast.success("Venta marcada como vendida.", "Se generó el número de venta y el seguimiento de cada unidad.");
    router.refresh();
  };

  return (
    <div className="rounded-2xl border border-accent/30 bg-accent/5 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-accent">
        Cerrar venta
      </p>
      {blocked ? (
        <>
          <p className="mt-1 text-xs text-muted-foreground">
            Falta firmar el contrato de{" "}
            <span className="font-medium text-foreground">
              {unsigned.join(", ")}
            </span>{" "}
            antes de poder marcar esta venta como vendida.
          </p>
          <div className="mt-3">
            <Button variant="primary" size="sm" disabled>
              Marcar venta como vendida
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-1 text-xs text-muted-foreground">
            Todos los contratos obligatorios están firmados. Al marcarla como
            vendida se genera el número de venta y el seguimiento de las
            unidades.
          </p>
          <div className="mt-3">
            <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
              Marcar venta como vendida
            </Button>
          </div>
        </>
      )}

      <Modal
        open={open}
        onClose={() => !busy && setOpen(false)}
        title="Marcar venta como vendida"
        description="Se generará el número de venta y el código de seguimiento de cada unidad. Esta acción queda registrada a tu nombre."
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancelar
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void confirm()}
              disabled={busy || blocked}
            >
              {busy ? "Marcando como vendida…" : "Marcar como vendida"}
            </Button>
          </>
        }
      >
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
      </Modal>
    </div>
  );
}
