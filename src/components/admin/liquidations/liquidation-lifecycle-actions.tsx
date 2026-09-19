"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/form-fields";
import { liquidationActionErrorText } from "@/lib/admin/liquidations-errors";
import { DEALER } from "@/config/dealer";
import {
  refreshLiquidationDraft,
  approveLiquidation,
  markLiquidationPaid,
} from "@/app/(admin)/admin/liquidaciones/actions";
import { toast } from "@/components/ui/toast";

/** `closesAt` es un instante absoluto (UTC) — se muestra SIEMPRE en la zona
 * horaria del concesionario, nunca en la del navegador de quien lo mira. */
function formatCloseDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("es-DO", { dateStyle: "medium", timeZone: DEALER.timezone }).format(d);
}

/** Controles de ciclo de vida: DRAFT (refrescar / ajustar / aprobar — solo
 * si la semana ya cerró) → APPROVED (marcar pagada, con referencia) → PAID
 * (nada más — inmutable). La semana en curso NUNCA puede aprobarse: el
 * backend (`WEEK_NOT_CLOSED`) es la barrera real, esto solo evita el viaje
 * redondo mostrando el motivo de antemano. */
export function LiquidationLifecycleActions({
  liquidationId,
  status,
  weekClosed,
  closesAt,
}: {
  liquidationId: string;
  status: "DRAFT" | "APPROVED" | "PAID";
  weekClosed: boolean;
  closesAt: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentReference, setPaymentReference] = useState("");
  const [showPayForm, setShowPayForm] = useState(false);

  const run = async (action: () => Promise<{ ok: boolean; code?: string }>, success?: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await action();
    if (!res.ok) {
      setError(liquidationActionErrorText(res.code));
      setBusy(false);
      return;
    }
    setBusy(false);
    if (success) toast.success(success);
    router.refresh();
  };

  if (status === "PAID") {
    return <p className="text-sm text-success">Liquidación pagada — no admite más cambios.</p>;
  }

  return (
    <div className="space-y-2">
      {status === "DRAFT" && !weekClosed && (
        <div className="rounded-lg border px-3 py-2 text-xs border-info/30 bg-info/10 text-info">
          <p className="font-semibold uppercase tracking-wide">Semana en curso</p>
          <p className="mt-0.5">
            Puedes revisar y actualizar esta liquidación. Podrás aprobarla cuando cierre la semana
            {closesAt && ` (a partir del ${formatCloseDate(closesAt)})`}.
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {status === "DRAFT" && (
          <>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => void run(() => refreshLiquidationDraft(liquidationId), "Liquidación actualizada.")}
            >
              Refrescar comisiones confirmadas
            </Button>
            {weekClosed && (
              <Button
                variant="primary"
                size="sm"
                disabled={busy}
                onClick={() => void run(() => approveLiquidation(liquidationId), "Liquidación aprobada.")}
              >
                Aprobar liquidación
              </Button>
            )}
          </>
        )}
        {status === "APPROVED" && !showPayForm && (
          <Button variant="primary" size="sm" disabled={busy} onClick={() => setShowPayForm(true)}>
            Marcar como pagada
          </Button>
        )}
      </div>

      {status === "APPROVED" && showPayForm && (
        <div className="flex flex-wrap items-end gap-2">
          <TextField
            label="Referencia de pago (opcional)"
            value={paymentReference}
            onChange={(e) => setPaymentReference(e.target.value)}
            placeholder="Ej.: TRANSF-0001"
          />
          <Button
            variant="primary"
            size="sm"
            disabled={busy}
            onClick={() => void run(() => markLiquidationPaid(liquidationId, paymentReference), "Liquidación marcada como pagada.")}
          >
            {busy ? "Guardando…" : "Confirmar pago"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setShowPayForm(false)} disabled={busy}>
            Cancelar
          </Button>
        </div>
      )}

      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}
