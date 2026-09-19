"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { liquidationActionErrorText } from "@/lib/admin/liquidations-errors";
import { createLiquidationDraft } from "@/app/(admin)/admin/liquidaciones/actions";
import { ROUTES } from "@/lib/constants";

/** Fila sin liquidación materializada todavía: crea el DRAFT (reclama las
 * comisiones de ventas confirmadas en la semana) y navega directo a su detalle. */
export function CreateDraftButton({ sellerId, weekStart }: { sellerId: string; weekStart: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await createLiquidationDraft(sellerId, weekStart);
    if (!res.ok) {
      setError(liquidationActionErrorText(res.code));
      setBusy(false);
      return;
    }
    router.push(`${ROUTES.adminLiquidaciones}/${res.liquidationId}`);
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="secondary" size="sm" onClick={() => void submit()} disabled={busy}>
        {busy ? "Creando…" : "Crear liquidación"}
      </Button>
      {error && <p role="alert" className="text-[11px] text-danger">{error}</p>}
    </div>
  );
}
