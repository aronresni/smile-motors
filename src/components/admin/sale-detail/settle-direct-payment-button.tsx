"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { formatCents } from "@/lib/money";
import { saleControlErrorText } from "@/lib/admin/sale-control-errors";
import { adminSettleDirectPayment } from "@/app/(admin)/admin/ventas/[saleId]/actions";

/** Pago directo (tarjeta / Zelle / interno) → LIQUIDADO. Solo admin. */
export function SettleDirectPaymentButton({
  saleId,
  allocationId,
  providerName,
  netCents,
}: {
  saleId: string;
  allocationId: string;
  providerName: string;
  netCents: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Marcar liquidado
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Liquidar pago · ${providerName}`}
        description="Confirma que el dinero de este pago directo ya se recibió."
        consequences={[
          `Se registra como LIQUIDADO el neto de ${formatCents(netCents)}.`,
          "Cuenta para el cobro de la venta; la venta NO pasa a pagada automáticamente.",
          "Queda registrado a tu nombre.",
        ]}
        confirmLabel="Marcar como liquidado"
        pendingLabel="Liquidando…"
        onConfirm={async () => {
          const res = await adminSettleDirectPayment(saleId, allocationId);
          if (!res.ok) return { ok: false, message: saleControlErrorText(res.code) };
          toast.success("Pago marcado como liquidado.");
          router.refresh();
          return { ok: true };
        }}
      />
    </>
  );
}
