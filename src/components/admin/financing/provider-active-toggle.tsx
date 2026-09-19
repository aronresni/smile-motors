"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { financingActionErrorText } from "@/lib/admin/financing-errors";
import { setProviderActive } from "@/app/(admin)/admin/financieras/actions";
import { toast } from "@/components/ui/toast";

/** Activar/desactivar un proveedor — SIEMPRE una RPC admin explícita, nunca
 * un simple cambio de estado local. Desactivar NUNCA borra nada: solo deja
 * de ser seleccionable en ventas nuevas (ver TEST 7). */
export function ProviderActiveToggle({
  providerId,
  providerName,
  isActive,
}: {
  providerId: string;
  providerName: string;
  isActive: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    if (busy) return;
    if (
      !confirm(
        isActive
          ? `¿Desactivar "${providerName}"? Dejará de ser seleccionable en ventas nuevas. Las ventas existentes no se ven afectadas.`
          : `¿Activar "${providerName}"? Volverá a ser seleccionable en ventas nuevas.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    const res = await setProviderActive(providerId, !isActive);
    if (!res.ok) {
      setError(financingActionErrorText(res.code));
      setBusy(false);
      return;
    }
    setBusy(false);
    toast.success(isActive ? "Financiera desactivada." : "Financiera activada.");
    router.refresh();
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant={isActive ? "danger" : "primary"} size="sm" onClick={() => void toggle()} disabled={busy}>
        {busy ? "Procesando…" : isActive ? "Desactivar" : "Activar"}
      </Button>
      {error && <p className="text-[11px] text-danger">{error}</p>}
    </div>
  );
}
