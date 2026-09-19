"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/constants";
import { approvalsErrorText } from "@/lib/admin/approvals-errors";
import {
  markFinancingSent,
  markFinancingAccredited,
} from "@/app/(seller)/seller/ventas/[saleId]/sale-actions";
import type { ContractInboxItem } from "@/lib/admin/approvals";
import { toast } from "@/components/ui/toast";

/** Reutiliza las acciones YA existentes de contrato (`mark_financing_sent`/
 * `mark_financing_accredited`) — mismo Server Action que ya usa la ficha de
 * venta. SIGNED lo puede marcar el propio vendedor o el admin desde la
 * venta; aquí solo se ofrece la acción que le corresponde al admin. */
export function ContractRowAction({
  item,
  allocationId,
  contractId,
}: {
  item: ContractInboxItem;
  allocationId: string;
  contractId: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<{ ok: boolean; code?: string }>, success?: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await fn();
    if (!res.ok) {
      setError(approvalsErrorText(res.code));
      setBusy(false);
      return;
    }
    setBusy(false);
    if (success) toast.success(success);
    router.refresh();
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1.5">
        {item.contractStatus === "NOT_SENT" && (
          <Button variant="primary" size="sm" onClick={() => void run(() => markFinancingSent(item.saleId, allocationId), "Contrato marcado como enviado.")} disabled={busy}>
            Enviar
          </Button>
        )}
        {item.contractStatus === "SIGNED" && contractId && (
          <Button
            variant="primary"
            size="sm"
            onClick={() => void run(() => markFinancingAccredited(item.saleId, contractId), "Contrato acreditado.")}
            disabled={busy}
          >
            Marcar acreditado
          </Button>
        )}
        <Link
          href={`${ROUTES.adminVentas}/${item.saleId}`}
          className="inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium border-border hover:bg-surface-elevated"
        >
          Ver venta
        </Link>
      </div>
      {error && <p className="max-w-[180px] text-right text-[10px] text-danger">{error}</p>}
    </div>
  );
}
