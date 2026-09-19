"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ROUTES } from "@/lib/constants";
import { productActionErrorText } from "@/lib/admin/product-errors";
import { duplicateProduct } from "@/app/(admin)/admin/productos/actions";

/** DUPLICAR PRODUCTO — nuevo ID, configuración general + precios (+
 * variantes opcionalmente). NUNCA copia legacy_id, imágenes ni historial de
 * ventas: nace INACTIVO. */
export function DuplicateProductButton({ productId, productName }: { productId: string; productName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [includeVariants, setIncludeVariants] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await duplicateProduct(productId, includeVariants);
    if (!res.ok) {
      setError(productActionErrorText(res.code));
      setBusy(false);
      return;
    }
    setBusy(false);
    setOpen(false);
    if (res.productId) router.push(`${ROUTES.adminProductos}/${res.productId as string}`);
  };

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Duplicar producto
      </Button>
      <Modal
        open={open}
        onClose={() => !busy && setOpen(false)}
        title="Duplicar producto"
        description={`Se creará un producto nuevo a partir de "${productName}": configuración general y precios se copian; nace INACTIVO, sin ID legado, sin imágenes ni historial de ventas.`}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={busy}>Cancelar</Button>
            <Button variant="primary" size="sm" onClick={() => void submit()} disabled={busy}>
              {busy ? "Duplicando…" : "Duplicar"}
            </Button>
          </>
        }
      >
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeVariants}
            onChange={(e) => setIncludeVariants(e.target.checked)}
          />
          Incluir variantes (colores)
        </label>
        {error && <p role="alert" className="mt-3 text-xs text-danger">{error}</p>}
      </Modal>
    </>
  );
}
