"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { TextField } from "@/components/ui/form-fields";
import { ROUTES } from "@/lib/constants";
import { productActionErrorText } from "@/lib/admin/product-errors";
import type { AdminProductFull } from "@/lib/admin/products";
import {
  createProduct,
  updateProduct,
  type CreateProductInput,
  type UpdateProductInput,
} from "@/app/(admin)/admin/productos/actions";

const centsToDollarsText = (cents: number | null | undefined) => (cents == null ? "" : String(cents / 100));
const dollarsTextToCents = (v: string) => {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : undefined;
};

interface FormState {
  legacyId: string;
  name: string;
  brand: string;
  category: string;
  displacement: string;
  power: string;
  engine: string;
  weight: string;
  basePriceDollars: string;
  shippingDollars: string;
  cubaTotalDollars: string;
}

function emptyState(): FormState {
  return {
    legacyId: "",
    name: "",
    brand: "",
    category: "",
    displacement: "",
    power: "",
    engine: "",
    weight: "",
    basePriceDollars: "",
    shippingDollars: "",
    cubaTotalDollars: "",
  };
}

function fromProduct(p: AdminProductFull): FormState {
  return {
    legacyId: p.legacy_id ?? "",
    name: p.name,
    brand: p.brand ?? "",
    category: p.category ?? "",
    displacement: p.displacement ?? "",
    power: p.power ?? "",
    engine: p.engine ?? "",
    weight: p.weight ?? "",
    basePriceDollars: centsToDollarsText(p.base_price_cents),
    shippingDollars: centsToDollarsText(p.shipping_cents),
    cubaTotalDollars: centsToDollarsText(p.cuba_total_cents),
  };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3 rounded-lg border p-3 border-border">
      <legend className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</legend>
      {children}
    </fieldset>
  );
}

function ProductFormBody({
  form,
  set,
  legacyLocked,
}: {
  form: FormState;
  set: (patch: Partial<FormState>) => void;
  legacyLocked: boolean;
}) {
  return (
    <div className="space-y-3">
      <Section title="General">
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Nombre" required value={form.name} onChange={(e) => set({ name: e.target.value })} />
          <TextField label="Marca" value={form.brand} onChange={(e) => set({ brand: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Categoría" value={form.category} onChange={(e) => set({ category: e.target.value })} />
          <TextField
            label="ID legado (opcional)"
            value={form.legacyId}
            disabled={legacyLocked}
            onChange={(e) => set({ legacyId: e.target.value })}
            hint={legacyLocked ? "No editable tras la creación." : "Déjalo vacío para un producto nuevo."}
          />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <TextField label="Cilindrada" value={form.displacement} onChange={(e) => set({ displacement: e.target.value })} />
          <TextField label="Potencia" value={form.power} onChange={(e) => set({ power: e.target.value })} />
          <TextField label="Motor" value={form.engine} onChange={(e) => set({ engine: e.target.value })} />
        </div>
        <TextField label="Peso" value={form.weight} onChange={(e) => set({ weight: e.target.value })} />
      </Section>

      <Section title="Precios">
        <div className="grid grid-cols-3 gap-3">
          <TextField
            label="Precio base (USD)"
            type="number"
            min={0}
            step="0.01"
            value={form.basePriceDollars}
            onChange={(e) => set({ basePriceDollars: e.target.value })}
          />
          <TextField
            label="Total Cuba (USD)"
            type="number"
            min={0}
            step="0.01"
            value={form.cubaTotalDollars}
            onChange={(e) => set({ cubaTotalDollars: e.target.value })}
            hint="Precio de lista para venta con destino a Cuba."
          />
          <TextField
            label="Envío (USD)"
            type="number"
            min={0}
            step="0.01"
            value={form.shippingDollars}
            onChange={(e) => set({ shippingDollars: e.target.value })}
          />
        </div>
      </Section>
    </div>
  );
}

/** `defaultOpen`: abre el modal al cargar (acción rápida `?nuevo=1`). */
export function CreateProductModal({ defaultOpen = false }: { defaultOpen?: boolean } = {}) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [form, setFormState] = useState<FormState>(emptyState());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (patch: Partial<FormState>) => setFormState((f) => ({ ...f, ...patch }));
  const close = () => {
    if (busy) return;
    setOpen(false);
    setFormState(emptyState());
    setError(null);
  };

  const submit = async () => {
    if (busy) return;
    if (!form.name.trim()) {
      setError("El nombre es obligatorio.");
      return;
    }
    setBusy(true);
    setError(null);
    const input: CreateProductInput = {
      name: form.name.trim(),
      brand: form.brand.trim() || undefined,
      category: form.category.trim() || undefined,
      displacement: form.displacement.trim() || undefined,
      power: form.power.trim() || undefined,
      engine: form.engine.trim() || undefined,
      weight: form.weight.trim() || undefined,
      isActive: true,
      basePriceCents: dollarsTextToCents(form.basePriceDollars),
      shippingCents: dollarsTextToCents(form.shippingDollars),
      cubaTotalCents: dollarsTextToCents(form.cubaTotalDollars),
      legacyId: form.legacyId.trim() || undefined,
    };
    const res = await createProduct(input);
    if (!res.ok) {
      setError(productActionErrorText(res.code));
      setBusy(false);
      return;
    }
    setBusy(false);
    close();
    if (res.productId) router.push(`${ROUTES.adminProductos}/${res.productId as string}`);
  };

  return (
    <>
      <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
        Nuevo producto
      </Button>
      <Modal
        open={open}
        onClose={close}
        title="Nuevo producto"
        size="xl"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={close} disabled={busy}>Cancelar</Button>
            <Button variant="primary" size="sm" onClick={() => void submit()} disabled={busy}>
              {busy ? "Creando…" : "Crear"}
            </Button>
          </>
        }
      >
        <ProductFormBody form={form} set={set} legacyLocked={false} />
        {error && <p role="alert" className="mt-3 text-xs text-danger">{error}</p>}
      </Modal>
    </>
  );
}

export function EditProductModal({ product }: { product: AdminProductFull }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setFormState] = useState<FormState>(() => fromProduct(product));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (patch: Partial<FormState>) => setFormState((f) => ({ ...f, ...patch }));
  const openModal = () => {
    setFormState(fromProduct(product));
    setError(null);
    setOpen(true);
  };
  const close = () => {
    if (busy) return;
    setOpen(false);
  };

  const submit = async () => {
    if (busy) return;
    if (!form.name.trim()) {
      setError("El nombre es obligatorio.");
      return;
    }
    setBusy(true);
    setError(null);
    const input: UpdateProductInput = {
      productId: product.id,
      name: form.name.trim(),
      brand: form.brand.trim() || undefined,
      category: form.category.trim() || undefined,
      displacement: form.displacement.trim() || undefined,
      power: form.power.trim() || undefined,
      engine: form.engine.trim() || undefined,
      weight: form.weight.trim() || undefined,
      basePriceCents: dollarsTextToCents(form.basePriceDollars),
      shippingCents: dollarsTextToCents(form.shippingDollars),
      cubaTotalCents: dollarsTextToCents(form.cubaTotalDollars),
    };
    const res = await updateProduct(input);
    if (!res.ok) {
      setError(productActionErrorText(res.code));
      setBusy(false);
      return;
    }
    setBusy(false);
    setOpen(false);
    router.refresh();
  };

  return (
    <>
      <Button variant="secondary" size="sm" onClick={openModal}>
        Editar
      </Button>
      <Modal
        open={open}
        onClose={close}
        title={`Editar ${product.name}`}
        description="Los cambios aquí son la configuración ACTUAL del catálogo. Las ventas ya registradas conservan el nombre/marca/precio con los que se guardaron — nunca se recalculan."
        size="xl"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={close} disabled={busy}>Cancelar</Button>
            <Button variant="primary" size="sm" onClick={() => void submit()} disabled={busy}>
              {busy ? "Guardando…" : "Guardar cambios"}
            </Button>
          </>
        }
      >
        <ProductFormBody form={form} set={set} legacyLocked />
        {error && <p role="alert" className="mt-3 text-xs text-danger">{error}</p>}
      </Modal>
    </>
  );
}
