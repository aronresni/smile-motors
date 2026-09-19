"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/components/ui/toast";
import { formatCents } from "@/lib/money";
import { confirmErrorText } from "@/lib/sales/confirm-errors";
import type { SettlementModel } from "@/lib/sales/confirmed-sale";
import {
  adminMarkSalePaid,
  confirmSaleClosing,
} from "@/app/(seller)/seller/ventas/[saleId]/sale-actions";

/**
 * Revisión de cierre de una venta VENDIDA, por un ADMIN. SOLD no implica que
 * ya se cobró — el cobro es un estado SEPARADO (`settlement`). El admin
 * elige explícitamente entre:
 *  A) "Cierre pendiente a cobrar" — registra la revisión, la venta sigue SOLD.
 *  B) "Marcar como pagada" — SOLD → PAID. SIEMPRE una acción humana, incluso
 *     cuando el sistema calcula que ya está completamente cubierto.
 */
export function ClosingReviewActions({
  saleId,
  settlement,
}: {
  saleId: string;
  settlement: SettlementModel;
}) {
  const router = useRouter();
  const [payOpen, setPayOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runClosing = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await confirmSaleClosing(saleId);
    if (!res.ok) {
      setError(confirmErrorText(res.code));
      setBusy(false);
      return;
    }
    setBusy(false);
    toast.success("Cierre registrado: pendiente a cobrar.");
    router.refresh();
  };

  const runMarkPaid = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await adminMarkSalePaid(saleId);
    if (!res.ok) {
      setError(confirmErrorText(res.code));
      setBusy(false);
      return;
    }
    setPayOpen(false);
    toast.success("Venta marcada como pagada.");
    router.refresh();
  };

  return (
    <div className="rounded-2xl border border-warning/30 bg-warning/5 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-warning">
        {settlement.readyForPaid ? "Cobro completo" : "Pendiente a cobrar"}
      </p>

      <div className="mt-2 grid grid-cols-3 gap-3 text-sm">
        <div>
          <p className="text-[11px] text-muted-foreground">Total operación</p>
          <p className="font-semibold tabular-nums text-foreground">
            {formatCents(settlement.saleTotalCents)}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground">Cobrado/acreditado</p>
          <p className="font-semibold tabular-nums text-foreground">
            {formatCents(settlement.amountCollectedCents)}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground">Pendiente</p>
          <p
            className={
              settlement.amountOutstandingCents > 0
                ? "font-semibold tabular-nums text-warning"
                : "font-semibold tabular-nums text-success"
            }
          >
            {formatCents(settlement.amountOutstandingCents)}
          </p>
        </div>
      </div>

      {settlement.readyForPaid ? (
        <p className="mt-3 rounded-lg bg-success/10 px-3 py-2 text-xs font-medium text-success">
          {formatCents(settlement.amountCollectedCents)} / {formatCents(settlement.saleTotalCents)} — cobro completo, lista para marcar como pagada.
        </p>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          Todavía falta dinero por cobrar. Puedes confirmar el cierre dejando
          la venta como pendiente a cobrar.
        </p>
      )}

      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void runClosing()}
          disabled={busy}
        >
          {busy ? "Procesando…" : "Cierre pendiente a cobrar"}
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={() => setPayOpen(true)}
          disabled={busy || !settlement.readyForPaid}
        >
          Marcar como pagada
        </Button>
      </div>

      {settlement.closingReviewedAt && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Última revisión:{" "}
          {new Intl.DateTimeFormat("es-DO", {
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date(settlement.closingReviewedAt))}
          {settlement.closingReviewedByName
            ? ` · ${settlement.closingReviewedByName}`
            : ""}
        </p>
      )}

      <Modal
        open={payOpen}
        onClose={() => !busy && setPayOpen(false)}
        title="Marcar venta como pagada"
        description="Esta acción registrará la venta como pagada. Queda registrada a tu nombre y no puede deshacerse desde aquí."
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPayOpen(false)}
              disabled={busy}
            >
              Cancelar
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void runMarkPaid()}
              disabled={busy}
            >
              {busy ? "Marcando como pagada…" : "Marcar como pagada"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-text-secondary">
          Total de la venta: {formatCents(settlement.saleTotalCents)}
          <br />
          Total acreditado/cobrado: {formatCents(settlement.amountCollectedCents)}
        </p>
      </Modal>
    </div>
  );
}
