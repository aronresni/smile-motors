"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { TextField, TextAreaField, SelectField } from "@/components/ui/form-fields";
import { ROUTES } from "@/lib/constants";
import { financingActionErrorText } from "@/lib/admin/financing-errors";
import type { AdminProviderFull, PaymentMethodType } from "@/lib/admin/financing";
import type { FeeStrategy } from "@/lib/payments/fee-engine";
import {
  createProvider,
  updateProvider,
  type CreateProviderInput,
  type UpdateProviderInput,
} from "@/app/(admin)/admin/financieras/actions";

const TYPE_OPTIONS: { value: PaymentMethodType; label: string }[] = [
  { value: "FINANCING", label: "Financiación (exige contrato firmado)" },
  { value: "CARD", label: "Tarjeta (pago directo)" },
  { value: "ZELLE", label: "Zelle (pago directo)" },
  { value: "INTERNAL", label: "Efectivo / interno (pago directo)" },
];

const FEE_STRATEGY_OPTIONS: { value: FeeStrategy; label: string }[] = [
  { value: "NONE", label: "Sin comisión" },
  { value: "FLAT_RATE", label: "Porcentaje fijo" },
  { value: "FIXED_AMOUNT", label: "Cargo fijo" },
  { value: "FIXED_PLUS_PERCENT", label: "Cargo fijo + porcentaje" },
  { value: "INSTALLMENTS", label: "Según plan (cada plan define su fee)" },
  { value: "CONDITIONAL", label: "Condicional (umbral)" },
];

const bpsToPercentText = (bps: number | null | undefined) => (bps == null ? "" : String(bps / 100));
const percentTextToBps = (v: string) => {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : undefined;
};
const centsToDollarsText = (cents: number | null | undefined) => (cents == null ? "" : String(cents / 100));
const dollarsTextToCents = (v: string) => {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : undefined;
};

interface FormState {
  legacyId: string;
  name: string;
  methodType: PaymentMethodType;
  subtext: string;
  instructions: string;
  position: string;
  requiresSignedContract: boolean;
  onlyFlorida: boolean;
  websiteUrl: string;
  websiteEnabled: boolean;
  feeStrategy: FeeStrategy;
  flatFeePercent: string;
  flatFeeDollars: string;
  conditionalThresholdDollars: string;
  conditionalBelowDollars: string;
  conditionalAbovePercent: string;
  /** true en edición: el código interno y el tipo ya no se pueden cambiar
   * (identidad del proveedor, referenciada por ventas históricas). */
  _locked?: boolean;
}

function emptyState(): FormState {
  return {
    legacyId: "",
    name: "",
    methodType: "FINANCING",
    subtext: "",
    instructions: "",
    position: "0",
    requiresSignedContract: true,
    onlyFlorida: false,
    websiteUrl: "",
    websiteEnabled: false,
    feeStrategy: "NONE",
    flatFeePercent: "",
    flatFeeDollars: "",
    conditionalThresholdDollars: "",
    conditionalBelowDollars: "",
    conditionalAbovePercent: "",
  };
}

function fromProvider(p: AdminProviderFull): FormState {
  return {
    legacyId: p.legacy_id,
    name: p.name,
    methodType: p.method_type,
    subtext: p.subtext ?? "",
    instructions: p.instructions ?? "",
    position: String(p.position ?? 0),
    requiresSignedContract: p.requires_signed_contract,
    onlyFlorida: p.only_florida,
    websiteUrl: p.website_url ?? "",
    websiteEnabled: p.website_enabled,
    feeStrategy: p.fee_strategy,
    flatFeePercent: bpsToPercentText(p.flat_fee_bps),
    flatFeeDollars: centsToDollarsText(p.flat_fee_cents),
    conditionalThresholdDollars: centsToDollarsText(p.conditional_threshold_cents),
    conditionalBelowDollars: centsToDollarsText(p.conditional_below_fee_cents),
    conditionalAbovePercent: bpsToPercentText(p.conditional_above_fee_bps),
  };
}

function FeeFields({ form, set }: { form: FormState; set: (patch: Partial<FormState>) => void }) {
  switch (form.feeStrategy) {
    case "FLAT_RATE":
      return (
        <TextField
          label="Comisión (%)"
          type="number"
          min={0}
          step="0.01"
          value={form.flatFeePercent}
          onChange={(e) => set({ flatFeePercent: e.target.value })}
        />
      );
    case "FIXED_AMOUNT":
      return (
        <TextField
          label="Cargo fijo (USD)"
          type="number"
          min={0}
          step="0.01"
          value={form.flatFeeDollars}
          onChange={(e) => set({ flatFeeDollars: e.target.value })}
        />
      );
    case "FIXED_PLUS_PERCENT":
      return (
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Cargo fijo (USD)"
            type="number"
            min={0}
            step="0.01"
            value={form.flatFeeDollars}
            onChange={(e) => set({ flatFeeDollars: e.target.value })}
          />
          <TextField
            label="Más porcentaje (%)"
            type="number"
            min={0}
            step="0.01"
            value={form.flatFeePercent}
            onChange={(e) => set({ flatFeePercent: e.target.value })}
          />
        </div>
      );
    case "CONDITIONAL":
      return (
        <div className="grid grid-cols-3 gap-3">
          <TextField
            label="Umbral (USD)"
            type="number"
            min={0}
            step="0.01"
            value={form.conditionalThresholdDollars}
            onChange={(e) => set({ conditionalThresholdDollars: e.target.value })}
          />
          <TextField
            label="Cargo si es menor (USD)"
            type="number"
            min={0}
            step="0.01"
            value={form.conditionalBelowDollars}
            onChange={(e) => set({ conditionalBelowDollars: e.target.value })}
          />
          <TextField
            label="% si es mayor"
            type="number"
            min={0}
            step="0.01"
            value={form.conditionalAbovePercent}
            onChange={(e) => set({ conditionalAbovePercent: e.target.value })}
          />
        </div>
      );
    case "INSTALLMENTS":
      return (
        <p className="text-[11px] text-muted-foreground">
          Cada plan (más abajo, en la ficha del proveedor) define su propio porcentaje de comisión.
        </p>
      );
    case "NONE":
    default:
      return null;
  }
}

function buildFeePayload(form: FormState) {
  return {
    flatFeeBps:
      form.feeStrategy === "FLAT_RATE" || form.feeStrategy === "FIXED_PLUS_PERCENT"
        ? percentTextToBps(form.flatFeePercent)
        : undefined,
    flatFeeCents:
      form.feeStrategy === "FIXED_AMOUNT" || form.feeStrategy === "FIXED_PLUS_PERCENT"
        ? dollarsTextToCents(form.flatFeeDollars)
        : undefined,
    conditionalThresholdCents:
      form.feeStrategy === "CONDITIONAL" ? dollarsTextToCents(form.conditionalThresholdDollars) : undefined,
    conditionalBelowFeeCents:
      form.feeStrategy === "CONDITIONAL" ? dollarsTextToCents(form.conditionalBelowDollars) : undefined,
    conditionalAboveFeeBps:
      form.feeStrategy === "CONDITIONAL" ? percentTextToBps(form.conditionalAbovePercent) : undefined,
  };
}

function ProviderFormBody({ form, set }: { form: FormState; set: (patch: Partial<FormState>) => void }) {
  const isFinancing = form.methodType === "FINANCING";
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <TextField
          label="Código interno"
          required
          value={form.legacyId}
          disabled={form.legacyId !== "" && form._locked}
          onChange={(e) => set({ legacyId: e.target.value })}
          hint="Identificador estable, no visible al comprador."
        />
        <SelectField
          label="Tipo"
          required
          disabled={form._locked}
          value={form.methodType}
          onChange={(e) => set({ methodType: e.target.value as PaymentMethodType })}
          options={TYPE_OPTIONS}
        />
      </div>
      <TextField
        label="Nombre para mostrar"
        required
        value={form.name}
        onChange={(e) => set({ name: e.target.value })}
      />
      <TextField
        label="Descripción (opcional)"
        value={form.subtext}
        onChange={(e) => set({ subtext: e.target.value })}
      />
      <TextAreaField
        label="Instrucciones (opcional)"
        value={form.instructions}
        onChange={(e) => set({ instructions: e.target.value })}
        hint="Texto operativo para el vendedor. Nunca guardes contraseñas del portal aquí."
      />

      {isFinancing && (
        <div className="space-y-2 rounded-lg border p-3 border-border">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.requiresSignedContract}
              onChange={(e) => set({ requiresSignedContract: e.target.checked })}
            />
            Requiere contrato firmado
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.onlyFlorida}
              onChange={(e) => set({ onlyFlorida: e.target.checked })}
            />
            Solo clientes de Florida
          </label>
          <TextField
            label="URL del portal (opcional)"
            type="url"
            value={form.websiteUrl}
            onChange={(e) => set({ websiteUrl: e.target.value })}
          />
        </div>
      )}

      <SelectField
        label="Estrategia de comisión"
        value={form.feeStrategy}
        onChange={(e) => set({ feeStrategy: e.target.value as FeeStrategy })}
        options={FEE_STRATEGY_OPTIONS}
      />
      <FeeFields form={form} set={set} />

      <TextField
        label="Orden"
        type="number"
        value={form.position}
        onChange={(e) => set({ position: e.target.value })}
        hint="Posición en la lista del vendedor (menor = primero)."
      />
    </div>
  );
}

export function CreateProviderModal() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
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
    if (!form.legacyId.trim() || !form.name.trim()) {
      setError("Completa el código interno y el nombre.");
      return;
    }
    setBusy(true);
    setError(null);
    const fee = buildFeePayload(form);
    const input: CreateProviderInput = {
      legacyId: form.legacyId.trim(),
      name: form.name.trim(),
      methodType: form.methodType,
      subtext: form.subtext.trim() || undefined,
      instructions: form.instructions.trim() || undefined,
      isActive: true,
      position: Number.parseInt(form.position, 10) || 0,
      requiresSignedContract: form.requiresSignedContract,
      onlyFlorida: form.onlyFlorida,
      websiteUrl: form.websiteUrl.trim() || undefined,
      websiteEnabled: Boolean(form.websiteUrl.trim()),
      feeStrategy: form.feeStrategy,
      ...fee,
    };
    const res = await createProvider(input);
    if (!res.ok) {
      setError(financingActionErrorText(res.code));
      setBusy(false);
      return;
    }
    setBusy(false);
    close();
    if (res.providerId) {
      router.push(`${ROUTES.adminFinancieras}/${res.providerId as string}`);
    }
  };

  return (
    <>
      <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
        Nueva financiera
      </Button>
      <Modal
        open={open}
        onClose={close}
        title="Nueva financiera / método de pago"
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
        <ProviderFormBody form={form} set={set} />
        {error && <p role="alert" className="mt-3 text-xs text-danger">{error}</p>}
      </Modal>
    </>
  );
}

export function EditProviderModal({ provider }: { provider: AdminProviderFull }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setFormState] = useState<FormState>(() => ({
    ...fromProvider(provider),
    _locked: true,
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (patch: Partial<FormState>) => setFormState((f) => ({ ...f, ...patch }));
  const openModal = () => {
    setFormState({ ...fromProvider(provider), _locked: true });
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
      setError("El nombre no puede quedar vacío.");
      return;
    }
    setBusy(true);
    setError(null);
    const fee = buildFeePayload(form);
    const input: UpdateProviderInput = {
      providerId: provider.id,
      name: form.name.trim(),
      methodType: form.methodType,
      subtext: form.subtext.trim() || undefined,
      instructions: form.instructions.trim() || undefined,
      position: Number.parseInt(form.position, 10) || 0,
      requiresSignedContract: form.requiresSignedContract,
      onlyFlorida: form.onlyFlorida,
      websiteUrl: form.websiteUrl.trim() || undefined,
      websiteEnabled: Boolean(form.websiteUrl.trim()),
      feeStrategy: form.feeStrategy,
      ...fee,
    };
    const res = await updateProvider(input);
    if (!res.ok) {
      setError(financingActionErrorText(res.code));
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
        title={`Editar ${provider.name}`}
        description="Los cambios aquí son la configuración ACTUAL. Las ventas ya registradas conservan la configuración vigente al momento de asignar el pago (fee, plan y requisito de contrato ya quedaron guardados con esa venta)."
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
        <ProviderFormBody form={form} set={set} />
        {error && <p role="alert" className="mt-3 text-xs text-danger">{error}</p>}
      </Modal>
    </>
  );
}
