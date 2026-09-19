"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { productActionErrorText } from "@/lib/admin/product-errors";
import { setProductActive } from "@/app/(admin)/admin/productos/actions";
import { toast } from "@/components/ui/toast";

/** Activar/desactivar un producto — SIEMPRE una RPC admin explícita. Nunca
 * borra nada: solo deja de ser seleccionable en ventas nuevas (TEST 4). */
export function ProductActiveToggle({
  productId,
  productName,
  isActive,
}: {
  productId: string;
  productName: string;
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
          ? `¿Desactivar "${productName}"? Dejará de ser seleccionable en ventas nuevas. Las ventas existentes no se ven afectadas.`
          : `¿Activar "${productName}"? Volverá a ser seleccionable en ventas nuevas.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    const res = await setProductActive(productId, !isActive);
    if (!res.ok) {
      setError(productActionErrorText(res.code));
      setBusy(false);
      return;
    }
    setBusy(false);
    toast.success(isActive ? "Producto desactivado." : "Producto activado.");
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
