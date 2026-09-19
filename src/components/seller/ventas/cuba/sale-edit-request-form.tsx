"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { toast } from "@/components/ui/toast";
import { TextField, TextAreaField, SelectField, ReadOnlyField } from "@/components/ui/form-fields";
import { SelectMenuField } from "@/components/ui/filter-select";
import { formatCents, parseAmountToCents, centsToInputvalue } from "@/lib/money";
import { ROUTES } from "@/lib/constants";
import { approvalsErrorText } from "@/lib/admin/approvals-errors";
import { getCatalogModel, type CatalogVariant } from "@/lib/sales/catalog";
import type { CubaSaleDraftDto } from "@/lib/sales/draft-transport";
import { computeCommission, isPricingConfigured } from "@/lib/commission";
import { CommissionBreakdownList } from "@/components/commission/commission-breakdown";

/** Precio fijo y comisión que rigen cada unidad (congelados si ya es VENDIDA). */
export type UnitPricingMap = Record<
  string,
  { fixedPriceCents: number | null; fixedCommissionCents: number | null; frozen: boolean }
>;
import {
  requestSaleEdit,
  type SaleEditChange,
} from "@/app/(seller)/seller/ventas/[saleId]/edit-request-actions";

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));

interface UnitFieldState {
  id: string;
  productId: string;
  productName: string;
  variantId: string;
  variantLabel: string;
  agreedPriceDollars: string;
}
interface ExtraFieldState {
  id: string;
  description: string;
  quantity: string;
  unitPriceDollars: string;
}

interface FormState {
  buyerFirstName: string;
  buyerLastName: string;
  buyerPhone: string;
  buyerEmail: string;
  buyerAddressLine1: string;
  buyerAddressLine2: string;
  buyerCity: string;
  buyerState: string;
  buyerPostalCode: string;
  buyerDocumentNumber: string;
  recipientFullName: string;
  recipientIdentityNumber: string;
  recipientDeliveryAddress: string;
  recipientMunicipality: string;
  recipientProvince: string;
  recipientPrimaryPhone: string;
  recipientSecondaryPhone: string;
  deliveryMethod: string;
  deliveryReference: string;
  internalNotes: string;
  units: UnitFieldState[];
  extras: ExtraFieldState[];
}

function buildInitialState(dto: CubaSaleDraftDto): FormState {
  const b = dto.buyer ?? {};
  const r = dto.cubaRecipient ?? {};
  const d = dto.delivery ?? {};
  return {
    buyerFirstName: str(b.first_name),
    buyerLastName: str(b.last_name),
    buyerPhone: str(b.phone),
    buyerEmail: str(b.email),
    buyerAddressLine1: str(b.address_line1),
    buyerAddressLine2: str(b.address_line2),
    buyerCity: str(b.city),
    buyerState: str(b.state),
    buyerPostalCode: str(b.postal_code),
    buyerDocumentNumber: str(b.document_number),
    recipientFullName: str(r.full_name),
    recipientIdentityNumber: str(r.identity_number),
    recipientDeliveryAddress: str(r.delivery_address),
    recipientMunicipality: str(r.municipality),
    recipientProvince: str(r.province),
    recipientPrimaryPhone: str(r.primary_phone),
    recipientSecondaryPhone: str(r.secondary_phone),
    deliveryMethod: str(d.method),
    deliveryReference: str(d.pickup_reference),
    internalNotes: str(dto.sale.internal_notes),
    units: dto.units.map((u) => ({
      id: str(u.id),
      productId: str(u.product_id),
      productName: str(u.product_name_snapshot),
      variantId: str(u.product_variant_id),
      variantLabel: str(u.variant_snapshot),
      agreedPriceDollars: centsToInputvalue(Number(u.agreed_price_cents) || 0),
    })),
    extras: dto.extras.map((e) => ({
      id: str(e.id),
      description: str(e.description),
      quantity: String(Number(e.quantity) || 1),
      unitPriceDollars: centsToInputvalue(Number(e.unit_price_cents) || 0),
    })),
  };
}

const DELIVERY_OPTIONS = [
  { value: "HOME_DELIVERY", label: "Entrega a domicilio" },
  { value: "PICKUP_POINT", label: "Punto de recogida" },
];

const FIELD_LABEL: Record<string, string> = {
  buyer_first_name: "Nombre del comprador",
  buyer_last_name: "Apellido del comprador",
  buyer_phone: "Teléfono del comprador",
  buyer_email: "Correo del comprador",
  buyer_address_line1: "Dirección (línea 1)",
  buyer_address_line2: "Dirección (línea 2)",
  buyer_city: "Ciudad",
  buyer_state: "Estado",
  buyer_postal_code: "Código postal",
  buyer_document_number: "N.º de documento del comprador",
  recipient_full_name: "Nombre del destinatario",
  recipient_identity_number: "CI/NI del destinatario",
  recipient_delivery_address: "Dirección de entrega",
  recipient_municipality: "Municipio",
  recipient_province: "Provincia",
  recipient_primary_phone: "Teléfono principal del destinatario",
  recipient_secondary_phone: "Teléfono secundario del destinatario",
  delivery_method: "Método de entrega",
  delivery_pickup_reference: "Referencia de entrega",
  internal_notes: "Notas internas",
};
function fieldLabel(path: string): string {
  if (path.startsWith("units.")) return "Precio acordado";
  if (path.startsWith("extras.")) return "Extra";
  return FIELD_LABEL[path.replace(".", "_")] ?? path;
}
function displayValue(path: string, v: string | null): string {
  if (!v) return "—";
  if (path.endsWith(".agreed_price_cents") || path.endsWith(".unit_price_cents")) {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? formatCents(n) : v;
  }
  if (path === "delivery.method") return DELIVERY_OPTIONS.find((o) => o.value === v)?.label ?? v;
  return v;
}

/** Selector de variante REAL (nunca texto libre): el admin aprueba contra
 * un `product_variant_id` válido del catálogo, igual que el resto de la
 * app. Incluye la variante actual aunque ya no esté activa, para no
 * "perderla" del desplegable si el catálogo cambió desde la venta. */
function UnitVariantSelect({
  productId,
  currentVariantId,
  currentVariantLabel,
  onChange,
}: {
  productId: string;
  currentVariantId: string;
  currentVariantLabel: string;
  onChange: (variantId: string, variantLabel: string) => void;
}) {
  const [variants, setVariants] = useState<CatalogVariant[]>(
    currentVariantId ? [{ id: currentVariantId, label: currentVariantLabel || "Variante actual" }] : [],
  );

  useEffect(() => {
    let alive = true;
    queueMicrotask(() => {
      if (!alive || !productId) return;
      getCatalogModel(productId).then((model) => {
        if (!alive || !model) return;
        setVariants((prev) => {
          const merged = [...model.variants];
          if (currentVariantId && !merged.some((v) => v.id === currentVariantId)) {
            merged.push({ id: currentVariantId, label: currentVariantLabel || "Variante actual (inactiva)" });
          }
          return merged.length > 0 ? merged : prev;
        });
      });
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  return (
    <SelectMenuField
      label="Variante / color"
      placeholder={variants.length === 0 ? "Sin variantes" : undefined}
      disabled={variants.length === 0}
      value={currentVariantId}
      onValueChange={(id) => {
        const label = variants.find((v) => v.id === id)?.label ?? "";
        onChange(id, label);
      }}
      options={variants.map((v) => ({ value: v.id, label: v.label }))}
      hint="El admin revisa la variante contra el catálogo al aprobar."
    />
  );
}

export function SaleEditRequestForm({
  saleId,
  dto,
  pricing = {},
}: {
  saleId: string;
  dto: CubaSaleDraftDto;
  pricing?: UnitPricingMap;
}) {
  const router = useRouter();
  const detailHref = `${ROUTES.sellerVentas}/${saleId}`;
  const initial = useMemo(() => buildInitialState(dto), [dto]);
  const [form, setForm] = useState<FormState>(initial);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));
  const setUnit = (id: string, patch: Partial<UnitFieldState>) =>
    setForm((f) => ({ ...f, units: f.units.map((u) => (u.id === id ? { ...u, ...patch } : u)) }));
  const setExtra = (id: string, patch: Partial<ExtraFieldState>) =>
    setForm((f) => ({ ...f, extras: f.extras.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));

  const changes: SaleEditChange[] = useMemo(() => {
    const list: SaleEditChange[] = [];
    const scalar = (path: string, oldVal: string, newVal: string) => {
      if (oldVal !== newVal) list.push({ path, oldValue: oldVal || null, newValue: newVal || null });
    };
    scalar("buyer.first_name", initial.buyerFirstName, form.buyerFirstName);
    scalar("buyer.last_name", initial.buyerLastName, form.buyerLastName);
    scalar("buyer.phone", initial.buyerPhone, form.buyerPhone);
    scalar("buyer.email", initial.buyerEmail, form.buyerEmail);
    scalar("buyer.address_line1", initial.buyerAddressLine1, form.buyerAddressLine1);
    scalar("buyer.address_line2", initial.buyerAddressLine2, form.buyerAddressLine2);
    scalar("buyer.city", initial.buyerCity, form.buyerCity);
    scalar("buyer.state", initial.buyerState, form.buyerState);
    scalar("buyer.postal_code", initial.buyerPostalCode, form.buyerPostalCode);
    scalar("buyer.document_number", initial.buyerDocumentNumber, form.buyerDocumentNumber);
    scalar("recipient.full_name", initial.recipientFullName, form.recipientFullName);
    scalar("recipient.identity_number", initial.recipientIdentityNumber, form.recipientIdentityNumber);
    scalar("recipient.delivery_address", initial.recipientDeliveryAddress, form.recipientDeliveryAddress);
    scalar("recipient.municipality", initial.recipientMunicipality, form.recipientMunicipality);
    scalar("recipient.province", initial.recipientProvince, form.recipientProvince);
    scalar("recipient.primary_phone", initial.recipientPrimaryPhone, form.recipientPrimaryPhone);
    scalar("recipient.secondary_phone", initial.recipientSecondaryPhone, form.recipientSecondaryPhone);
    scalar("delivery.method", initial.deliveryMethod, form.deliveryMethod);
    scalar("delivery.pickup_reference", initial.deliveryReference, form.deliveryReference);
    scalar("internal_notes", initial.internalNotes, form.internalNotes);

    for (const u of form.units) {
      const orig = initial.units.find((x) => x.id === u.id);
      if (!orig) continue;
      if (orig.variantId !== u.variantId) {
        list.push({ path: `units.${u.id}.variant_id`, oldValue: orig.variantId || null, newValue: u.variantId || null });
      }
      const oldCents = parseAmountToCents(orig.agreedPriceDollars);
      const newCents = parseAmountToCents(u.agreedPriceDollars);
      if (oldCents !== newCents) {
        list.push({ path: `units.${u.id}.agreed_price_cents`, oldValue: String(oldCents), newValue: String(newCents) });
      }
    }
    for (const e of form.extras) {
      const orig = initial.extras.find((x) => x.id === e.id);
      if (!orig) continue;
      if (orig.description !== e.description) {
        list.push({ path: `extras.${e.id}.description`, oldValue: orig.description || null, newValue: e.description || null });
      }
      if (orig.quantity !== e.quantity) {
        list.push({ path: `extras.${e.id}.quantity`, oldValue: orig.quantity, newValue: e.quantity });
      }
      const oldCents = parseAmountToCents(orig.unitPriceDollars);
      const newCents = parseAmountToCents(e.unitPriceDollars);
      if (oldCents !== newCents) {
        list.push({ path: `extras.${e.id}.unit_price_cents`, oldValue: String(oldCents), newValue: String(newCents) });
      }
    }
    return list;
  }, [form, initial]);

  /** Error de precio de una unidad cuyo precio cambió (null = válido o sin cambio). */
  const unitPriceError = (u: UnitFieldState): string | null => {
    const orig = initial.units.find((x) => x.id === u.id);
    const cents = parseAmountToCents(u.agreedPriceDollars);
    if (!orig || parseAmountToCents(orig.agreedPriceDollars) === cents) return null;
    if (cents <= 0) return "Escribe un precio de venta mayor que $0.";
    const p = pricing[u.id];
    if (!p) return null;
    if (!p.frozen && !isPricingConfigured(p.fixedPriceCents, p.fixedCommissionCents)) {
      return "Este producto no tiene precio fijo o comisión fija: un administrador debe configurarlo antes.";
    }
    if (p.fixedPriceCents != null && cents < p.fixedPriceCents) {
      return `No puede ser inferior al precio fijo (${formatCents(p.fixedPriceCents)}).`;
    }
    return null;
  };

  const openReview = () => {
    if (changes.length === 0) {
      setError("No hay cambios para enviar.");
      return;
    }
    const priceError = form.units.map(unitPriceError).find(Boolean);
    if (priceError) {
      setError(priceError);
      return;
    }
    setError(null);
    setReasonOpen(true);
  };

  const submit = async () => {
    if (saving) return;
    if (reason.trim().length < 4) {
      setError("Describe el motivo (mínimo 4 caracteres).");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await requestSaleEdit(saleId, reason.trim(), changes);
    if (!res.ok) {
      setError(approvalsErrorText(res.code));
      setSaving(false);
      return;
    }
    setSaving(false);
    setReasonOpen(false);
    toast.success("Solicitud de edición enviada.", "Un administrador la revisará; la venta no cambia hasta entonces.");
    router.push(detailHref);
    router.refresh();
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-warning">Solicitar edición</p>
        <h1 className="mt-1 text-lg font-semibold tracking-tight text-foreground sm:text-xl">
          {dto.sale.sale_number ?? "Venta"}
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Esta venta ya no se edita directamente. Los cambios que propongas quedan pendientes hasta que un
          administrador los apruebe — la venta actual no cambia todavía.
        </p>
      </div>

      <div className="space-y-4 rounded-2xl border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold text-foreground">Comprador</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Nombre" value={form.buyerFirstName} onChange={(e) => set({ buyerFirstName: e.target.value })} />
          <TextField label="Apellido" value={form.buyerLastName} onChange={(e) => set({ buyerLastName: e.target.value })} />
          <TextField label="Teléfono" value={form.buyerPhone} onChange={(e) => set({ buyerPhone: e.target.value })} />
          <TextField label="Correo" value={form.buyerEmail} onChange={(e) => set({ buyerEmail: e.target.value })} />
          <TextField label="N.º de documento" value={form.buyerDocumentNumber} onChange={(e) => set({ buyerDocumentNumber: e.target.value })} />
          <TextField label="Ciudad" value={form.buyerCity} onChange={(e) => set({ buyerCity: e.target.value })} />
          <TextField label="Estado" value={form.buyerState} onChange={(e) => set({ buyerState: e.target.value })} />
          <TextField label="Código postal" value={form.buyerPostalCode} onChange={(e) => set({ buyerPostalCode: e.target.value })} />
          <TextField label="Dirección (línea 1)" value={form.buyerAddressLine1} onChange={(e) => set({ buyerAddressLine1: e.target.value })} containerClassName="sm:col-span-2" />
          <TextField label="Dirección (línea 2)" value={form.buyerAddressLine2} onChange={(e) => set({ buyerAddressLine2: e.target.value })} containerClassName="sm:col-span-2" />
        </div>
      </div>

      <div className="space-y-4 rounded-2xl border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold text-foreground">Unidades</h2>
        {form.units.map((u) => (
          <div key={u.id} className="grid gap-3 rounded-lg border border-border/60 p-3 sm:grid-cols-2">
            <ReadOnlyField label="Producto" value={u.productName} hint="El producto no se puede cambiar desde una solicitud de edición." />
            <UnitVariantSelect
              productId={u.productId}
              currentVariantId={u.variantId}
              currentVariantLabel={u.variantLabel}
              onChange={(variantId, variantLabel) => setUnit(u.id, { variantId, variantLabel })}
            />
            <TextField
              label="Precio de venta (USD)"
              type="number"
              min={pricing[u.id]?.fixedPriceCents ? pricing[u.id]!.fixedPriceCents! / 100 : 0}
              step="0.01"
              value={u.agreedPriceDollars}
              error={unitPriceError(u) ?? undefined}
              hint={
                pricing[u.id]?.fixedPriceCents
                  ? `Mínimo: precio fijo ${pricing[u.id]!.frozen ? "congelado " : ""}${formatCents(pricing[u.id]!.fixedPriceCents!)}.`
                  : undefined
              }
              onChange={(e) => setUnit(u.id, { agreedPriceDollars: e.target.value })}
            />
            <UnitCommissionEstimate unit={u} pricing={pricing[u.id]} />
          </div>
        ))}
      </div>

      {form.extras.length > 0 && (
        <div className="space-y-4 rounded-2xl border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold text-foreground">Extras</h2>
          {form.extras.map((e) => (
            <div key={e.id} className="grid gap-3 rounded-lg border border-border/60 p-3 sm:grid-cols-3">
              <TextField label="Descripción" value={e.description} onChange={(ev) => setExtra(e.id, { description: ev.target.value })} />
              <TextField label="Cantidad" type="number" min={1} value={e.quantity} onChange={(ev) => setExtra(e.id, { quantity: ev.target.value })} />
              <TextField label="Precio unitario (USD)" type="number" min={0} step="0.01" value={e.unitPriceDollars} onChange={(ev) => setExtra(e.id, { unitPriceDollars: ev.target.value })} />
            </div>
          ))}
        </div>
      )}

      <div className="space-y-4 rounded-2xl border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold text-foreground">Destinatario en Cuba</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Nombre completo" value={form.recipientFullName} onChange={(e) => set({ recipientFullName: e.target.value })} />
          <TextField label="CI / NI" value={form.recipientIdentityNumber} onChange={(e) => set({ recipientIdentityNumber: e.target.value })} />
          <TextField label="Teléfono principal" value={form.recipientPrimaryPhone} onChange={(e) => set({ recipientPrimaryPhone: e.target.value })} />
          <TextField label="Teléfono secundario" value={form.recipientSecondaryPhone} onChange={(e) => set({ recipientSecondaryPhone: e.target.value })} />
          <TextField label="Municipio" value={form.recipientMunicipality} onChange={(e) => set({ recipientMunicipality: e.target.value })} />
          <TextField label="Provincia" value={form.recipientProvince} onChange={(e) => set({ recipientProvince: e.target.value })} />
          <TextField label="Dirección de entrega" value={form.recipientDeliveryAddress} onChange={(e) => set({ recipientDeliveryAddress: e.target.value })} containerClassName="sm:col-span-2" />
        </div>
      </div>

      <div className="space-y-4 rounded-2xl border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold text-foreground">Entrega y notas</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label="Método de entrega"
            value={form.deliveryMethod}
            onChange={(e) => set({ deliveryMethod: e.target.value })}
            options={DELIVERY_OPTIONS}
          />
          <TextField label="Referencia" value={form.deliveryReference} onChange={(e) => set({ deliveryReference: e.target.value })} />
        </div>
        <TextAreaField label="Notas internas" value={form.internalNotes} onChange={(e) => set({ internalNotes: e.target.value })} />
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-danger/30 bg-danger-surface px-3.5 py-2.5 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-end">
        <Button variant="ghost" onClick={() => router.push(detailHref)} className="sm:mr-auto">
          Cancelar
        </Button>
        <Button variant="primary" onClick={openReview}>
          Revisar cambios
        </Button>
      </div>

      <Modal
        open={reasonOpen}
        onClose={() => !saving && setReasonOpen(false)}
        title="Resumen de cambios"
        size="lg"
        description="Estos cambios quedan pendientes de aprobación — la venta actual no se modifica todavía."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setReasonOpen(false)} disabled={saving}>Volver</Button>
            <Button variant="primary" size="sm" onClick={() => void submit()} disabled={saving || reason.trim().length < 4}>
              {saving ? "Enviando solicitud…" : "Enviar para aprobación"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <ul className="space-y-2">
            {changes.map((c, i) => (
              <li key={i} className="rounded-lg bg-surface-muted/50 p-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{fieldLabel(c.path)}</p>
                <div className="mt-1 flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground line-through">{displayValue(c.path, c.oldValue)}</span>
                  <span className="text-muted-foreground">→</span>
                  <span className="font-medium text-foreground">{displayValue(c.path, c.newValue)}</span>
                </div>
              </li>
            ))}
          </ul>
          <TextAreaField
            label="Motivo de la modificación"
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ej.: Se corrigió el precio acordado con el cliente."
          />
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
        </div>
      </Modal>
    </div>
  );
}

/** Comisión con el precio propuesto: snapshot congelado (VENDIDA) o configuración vigente. */
function UnitCommissionEstimate({
  unit,
  pricing,
}: {
  unit: UnitFieldState;
  pricing?: UnitPricingMap[string];
}) {
  if (!pricing || !isPricingConfigured(pricing.fixedPriceCents, pricing.fixedCommissionCents)) return null;
  const b = computeCommission(pricing.fixedPriceCents, pricing.fixedCommissionCents!, parseAmountToCents(unit.agreedPriceDollars));
  if (b.belowFixedPrice) return null;
  return (
    <div className="rounded-lg border border-border bg-surface-muted px-3 py-2.5 sm:col-span-2">
      <p className="mb-2 text-xs font-medium text-foreground">
        {pricing.frozen ? "Tu comisión con este precio (valores congelados)" : "Tu comisión estimada con este precio"}
      </p>
      <CommissionBreakdownList breakdown={b} frozen={pricing.frozen} label={`Comisión · ${unit.productName}`} />
    </div>
  );
}
