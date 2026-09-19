"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { TextField } from "@/components/ui/form-fields";
import { productActionErrorText } from "@/lib/admin/product-errors";
import type { AdminProductVariant } from "@/lib/admin/products";
import { createVariant, setVariantActive, updateVariant } from "@/app/(admin)/admin/productos/actions";

interface VariantFormState {
  colorName: string;
}

function emptyForm(): VariantFormState {
  return { colorName: "" };
}
function fromVariant(v: AdminProductVariant): VariantFormState {
  return { colorName: v.colorName };
}

function VariantFormModal({
  productId,
  variant,
  open,
  onClose,
  onSaved,
}: {
  productId: string;
  variant: AdminProductVariant | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<VariantFormState>(variant ? fromVariant(variant) : emptyForm());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const key = `${open}-${variant?.id ?? "new"}`;
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setForm(variant ? fromVariant(variant) : emptyForm());
    setError(null);
  }

  const submit = async () => {
    if (busy) return;
    if (!form.colorName.trim()) {
      setError("El color/acabado es obligatorio.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = variant
      ? await updateVariant({
          variantId: variant.id,
          productId,
          colorName: form.colorName.trim(),
        })
      : await createVariant({
          productId,
          colorName: form.colorName.trim(),
        });
    if (!res.ok) {
      setError(productActionErrorText(res.code));
      setBusy(false);
      return;
    }
    setBusy(false);
    onSaved();
  };

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title={variant ? `Editar variante: ${variant.colorName}` : "Nueva variante"}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={() => void submit()} disabled={busy}>
            {busy ? "Guardando…" : variant ? "Guardar" : "Crear variante"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <TextField
          label="Color / acabado"
          required
          value={form.colorName}
          onChange={(e) => setForm((f) => ({ ...f, colorName: e.target.value }))}
          placeholder="Ej.: NEGRO"
        />
        {variant && variant.salesUsingCount > 0 && (
          <p className="text-[11px] text-muted-foreground">
            Esta variante ya se usó en {variant.salesUsingCount} venta(s). Los cambios aquí son la configuración
            ACTUAL — las ventas ya registradas conservan el color con el que se crearon.
          </p>
        )}
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </div>
    </Modal>
  );
}

function VariantRow({
  variant,
  productId,
  onEdit,
}: {
  variant: AdminProductVariant;
  productId: string;
  onEdit: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    if (busy) return;
    if (
      variant.isActive &&
      !confirm(`¿Desactivar la variante "${variant.colorName}"? Dejará de ser seleccionable en ventas nuevas.`)
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    const res = await setVariantActive(variant.id, productId, !variant.isActive);
    if (!res.ok) setError(productActionErrorText(res.code));
    setBusy(false);
    router.refresh();
  };

  return (
    <tr className="border-b last:border-0 border-border/70">
      <td className="px-3 py-2 align-top font-medium">
        {variant.colorName}
      </td>
      <td className="px-3 py-2 align-top">
        <span
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            variant.isActive
              ? "border-success/30 bg-success/10 text-success"
              : "border-border bg-surface-muted text-muted-foreground"
          }`}
        >
          {variant.isActive ? "Activa" : "Inactiva"}
        </span>
      </td>
      <td className="px-3 py-2 text-right align-top tabular-nums">{variant.salesUsingCount}</td>
      <td className="px-3 py-2 text-right align-top">
        <div className="flex flex-col items-end gap-1">
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={onEdit}
              className="rounded-md border px-2 py-1 text-[11px] font-medium border-border hover:bg-surface-elevated"
            >
              Editar
            </button>
            <button
              type="button"
              onClick={() => void toggle()}
              disabled={busy}
              className={`rounded-md border px-2 py-1 text-[11px] font-medium disabled:opacity-50 ${
                variant.isActive
                  ? "border-danger/30 text-danger hover:bg-danger/10"
                  : "border-border hover:bg-surface-elevated"
              }`}
            >
              {variant.isActive ? "Desactivar" : "Activar"}
            </button>
          </div>
          {error && <p className="text-[10px] text-danger">{error}</p>}
        </div>
      </td>
    </tr>
  );
}

export function VariantManager({ productId, variants }: { productId: string; variants: AdminProductVariant[] }) {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingVariant, setEditingVariant] = useState<AdminProductVariant | null>(null);
  const sorted = [...variants].sort((a, b) => a.colorName.localeCompare(b.colorName));

  const openCreate = () => {
    setEditingVariant(null);
    setModalOpen(true);
  };
  const openEdit = (v: AdminProductVariant) => {
    setEditingVariant(v);
    setModalOpen(true);
  };
  const onSaved = () => {
    setModalOpen(false);
    router.refresh();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {sorted.length === 0 ? "Sin variantes configuradas." : `${sorted.length} variante(s).`}
        </p>
        <Button variant="secondary" size="sm" onClick={openCreate}>Agregar variante</Button>
      </div>

      {sorted.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground border-border bg-surface">
                  <th className="px-3 py-2 font-medium">Color / acabado</th>
                  <th className="px-3 py-2 font-medium">Estado</th>
                  <th className="px-3 py-2 text-right font-medium">Ventas</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((v) => (
                  <VariantRow key={v.id} variant={v} productId={productId} onEdit={() => openEdit(v)} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <VariantFormModal
        productId={productId}
        variant={editingVariant}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={onSaved}
      />
    </div>
  );
}
