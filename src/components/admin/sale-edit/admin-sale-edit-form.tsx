"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TextAreaField, TextField, SelectField, ReadOnlyField } from "@/components/ui/form-fields";
import { SelectMenuField } from "@/components/ui/filter-select";
import { Toggle } from "@/components/ui/toggle";
import { toast } from "@/components/ui/toast";
import {
  AlertTriangleIcon,
  InfoIcon,
  LockIcon,
  MapPinIcon,
  NoteIcon,
  PackageIcon,
  PlusIcon,
  ShieldIcon,
  TrashIcon,
  TruckIcon,
  UserIcon,
  UsersIcon,
} from "@/components/ui/icons";
import { ModelSearchSelect } from "@/components/seller/ventas/cuba/model-search-select";
import { getCatalogModel, type CatalogVariant } from "@/lib/sales/catalog";
import { CUBA_PROVINCES } from "@/lib/sales/cuba-provinces";
import { US_STATES } from "@/lib/sales/us-states";
import { centsToInputvalue, formatCents, parseAmountToCents } from "@/lib/money";
import { computeCommission, isPricingConfigured } from "@/lib/commission";
import { CommissionBreakdownList } from "@/components/commission/commission-breakdown";
import Link from "next/link";
import { ROUTES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { useUnsavedChangesWarning } from "@/hooks/use-unsaved-changes-warning";
import { saleControlErrorText, validationList } from "@/lib/admin/sale-control-errors";
import {
  diffState,
  estimateTotalCents,
  toPayload,
  unitPricing,
  validate,
  type AdminSaleEditState,
  type ExtraRow,
  type FieldErrors,
  type UnitRow,
} from "@/lib/admin/sale-edit-form";
import { adminUpdateSale } from "@/app/(admin)/admin/ventas/[saleId]/actions";

interface Props {
  saleId: string;
  status: "DRAFT" | "PENDING" | "SOLD" | "PAID";
  saleNumber: string | null;
  sellerName: string;
  expectedUpdatedAt: string | null;
  deliveryCents: number;
  originalTotalCents: number;
  initial: AdminSaleEditState;
  detailHref: string;
}

const DELIVERY_OPTIONS = [
  { value: "HOME_DELIVERY", label: "Entrega a domicilio" },
  { value: "PICKUP_POINT", label: "Punto de recogida" },
];

let tmpSeq = 0;
const tmpKey = (p: string) => `${p}-new-${++tmpSeq}`;

function Section({
  id,
  title,
  icon,
  dirty,
  children,
  aside,
}: {
  id: string;
  title: string;
  icon: ReactNode;
  dirty?: boolean;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 rounded-2xl border border-border bg-surface p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <span className="text-brand">{icon}</span>
          {title}
          {dirty && (
            <span className="rounded-full border border-brand/40 bg-brand-soft px-2 py-px text-[10px] font-bold uppercase tracking-wider text-brand">
              Modificado
            </span>
          )}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function LockNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
      <LockIcon size={12} className="mt-px shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function VariantSelect({
  productId,
  value,
  label,
  disabled,
  onChange,
}: {
  productId: string;
  value: string;
  label: string;
  disabled?: boolean;
  onChange: (id: string, label: string) => void;
}) {
  const [variants, setVariants] = useState<CatalogVariant[]>(value ? [{ id: value, label: label || "Variante actual" }] : []);
  useEffect(() => {
    let alive = true;
    if (!productId) return;
    getCatalogModel(productId).then((m) => {
      if (!alive || !m) return;
      const merged = [...m.variants];
      if (value && !merged.some((v) => v.id === value)) merged.push({ id: value, label: label || "Variante actual (inactiva)" });
      setVariants(merged);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recarga solo al cambiar el producto
  }, [productId]);

  return (
    <SelectMenuField
      label="Variante / color"
      placeholder={variants.length === 0 ? "Sin variantes" : "Sin variante"}
      disabled={disabled || variants.length === 0}
      value={value}
      onValueChange={(id) => onChange(id, variants.find((v) => v.id === id)?.label ?? "")}
      options={variants.map((v) => ({ value: v.id, label: v.label }))}
    />
  );
}

export function AdminSaleEditForm({
  saleId,
  status,
  saleNumber,
  sellerName,
  expectedUpdatedAt,
  deliveryCents,
  originalTotalCents,
  initial,
  detailHref,
}: Props) {
  const router = useRouter();
  const [form, setForm] = useState<AdminSaleEditState>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [attempted, setAttempted] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  const isPaid = status === "PAID";
  const isSold = status === "SOLD";
  const structureLocked = isPaid || isSold;
  const changes = useMemo(() => diffState(initial, form), [initial, form]);
  const dirty = changes.length > 0;
  useUnsavedChangesWarning(dirty && !saved);

  const total = estimateTotalCents(form, deliveryCents);
  // Base de comparación: el total guardado; si aún no existe (borrador /
  // pendiente), el mismo cálculo sobre los datos originales.
  const baselineTotal = originalTotalCents > 0 ? originalTotalCents : estimateTotalCents(initial, deliveryCents);
  const totalChanged = total !== baselineTotal;
  const financialChanges = changes.some((c) => c.financial);

  const set = <K extends keyof AdminSaleEditState>(key: K, value: AdminSaleEditState[K]) => {
    const next = { ...form, [key]: value };
    setForm(next);
    if (attempted) setErrors(validate(next, initial, status));
  };
  const patch = <K extends "buyer" | "coBuyer" | "recipient" | "delivery">(key: K, value: Partial<AdminSaleEditState[K]>) =>
    set(key, { ...form[key], ...value } as AdminSaleEditState[K]);
  const setUnit = (key: string, value: Partial<UnitRow>) =>
    set("units", form.units.map((u) => (u.key === key ? { ...u, ...value } : u)));
  const setExtra = (key: string, value: Partial<ExtraRow>) =>
    set("extras", form.extras.map((x) => (x.key === key ? { ...x, ...value } : x)));

  const err = (k: string) => (attempted ? errors[k] : undefined);
  const sectionDirty = (section: string) => changes.some((c) => c.section === section);

  const openConfirm = () => {
    const errs = validate(form, initial, status);
    setAttempted(true);
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      toast.error("Revisa los campos marcados.", `${Object.keys(errs).length} campo(s) requieren atención.`);
      // Tras el render que marca los errores: foco + scroll al primer campo inválido.
      window.setTimeout(() => {
        const first = document.querySelector('[aria-invalid="true"]') as HTMLElement | null;
        first?.focus();
        first?.scrollIntoView({ block: "center", behavior: "smooth" });
      }, 0);
      return;
    }
    if (!dirty) {
      toast.info("No hay cambios para guardar.");
      return;
    }
    setConfirmOpen(true);
  };

  const confirmTitle = isPaid ? "Aplicar corrección administrativa" : "Guardar cambios de la venta";
  const confirmLabel = isPaid ? "Aplicar corrección" : "Guardar cambios";

  const banner = {
    DRAFT: {
      tone: "info" as const,
      title: "Borrador",
      text: "Puedes completar y corregir todos los datos. Los pagos del borrador los gestiona el vendedor en su formulario.",
    },
    PENDING: {
      tone: "warning" as const,
      title: "Venta en revisión",
      text: "Cada cambio exige motivo y queda auditado. Si cambias importes, los pagos asignados deben volver a cubrir el total exacto antes de poder marcarla vendida.",
    },
    SOLD: {
      tone: "warning" as const,
      title: "Venta vendida — corrección con motivo",
      text: "El servidor recalcula totales y la comisión usando su snapshot (nunca la configuración actual). No se agregan ni quitan unidades. Si el total deja de coincidir con lo cobrado se marcará CONCILIACIÓN REQUERIDA.",
    },
    PAID: {
      tone: "danger" as const,
      title: "Corrección administrativa · venta pagada",
      text: "La verdad financiera está cerrada: importes, unidades y extras no se modifican. Solo datos no financieros, con motivo y confirmación. El historial original se conserva.",
    },
  }[status];

  return (
    <div className="space-y-4 pb-28">
      <div
        className={cn(
          "flex items-start gap-3 rounded-2xl border p-4",
          banner.tone === "info" && "border-info/30 bg-info-soft",
          banner.tone === "warning" && "border-warning/30 bg-warning-soft",
          banner.tone === "danger" && "border-danger/35 bg-danger-surface",
        )}
      >
        <span
          className={cn(
            "mt-0.5 shrink-0",
            banner.tone === "info" && "text-info",
            banner.tone === "warning" && "text-warning",
            banner.tone === "danger" && "text-danger",
          )}
        >
          {isPaid ? <ShieldIcon size={18} /> : banner.tone === "info" ? <InfoIcon size={18} /> : <AlertTriangleIcon size={18} />}
        </span>
        <div>
          <p className="text-sm font-semibold text-foreground">{banner.title}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-text-secondary">{banner.text}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {saleNumber ?? "Venta sin número"} · Vendedor: {sellerName} · Los documentos y los pagos no se editan aquí.
          </p>
        </div>
      </div>

      {/* ------------------------------------------------------ comprador */}
      <Section id="sec-buyer" title="Comprador" icon={<UserIcon size={16} />} dirty={sectionDirty("Comprador")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Nombre" required value={form.buyer.firstName} error={err("buyer.firstName")} onChange={(e) => patch("buyer", { firstName: e.target.value })} />
          <TextField label="Apellidos" required value={form.buyer.lastName} error={err("buyer.lastName")} onChange={(e) => patch("buyer", { lastName: e.target.value })} />
          <TextField label="Teléfono" required type="tel" inputMode="tel" value={form.buyer.phone} error={err("buyer.phone")} onChange={(e) => patch("buyer", { phone: e.target.value })} />
          <TextField label="Correo" type="email" inputMode="email" value={form.buyer.email} error={err("buyer.email")} onChange={(e) => patch("buyer", { email: e.target.value })} />
          <TextField label="N.º de documento (ID / licencia)" required value={form.buyer.documentNumber} error={err("buyer.documentNumber")} onChange={(e) => patch("buyer", { documentNumber: e.target.value })} />
          <TextField label="Vencimiento del documento" type="date" value={form.buyer.documentExpiration} onChange={(e) => patch("buyer", { documentExpiration: e.target.value })} />
          <TextField label="Fecha de nacimiento" type="date" value={form.buyer.dateOfBirth} onChange={(e) => patch("buyer", { dateOfBirth: e.target.value })} />
          <TextField label="Dirección" value={form.buyer.addressLine1} onChange={(e) => patch("buyer", { addressLine1: e.target.value })} />
          <TextField label="Dirección (línea 2)" value={form.buyer.addressLine2} onChange={(e) => patch("buyer", { addressLine2: e.target.value })} />
          <TextField label="Ciudad" value={form.buyer.city} onChange={(e) => patch("buyer", { city: e.target.value })} />
          <SelectField
            label="Estado"
            placeholder="Sin estado"
            value={form.buyer.state}
            onChange={(e) => patch("buyer", { state: e.target.value })}
            options={US_STATES.map((s) => ({ value: s.code, label: `${s.code} · ${s.name}` }))}
            hint="Algunas financieras solo aplican a Florida (FL)."
          />
          <TextField label="Código postal" inputMode="numeric" value={form.buyer.postalCode} onChange={(e) => patch("buyer", { postalCode: e.target.value })} />
        </div>
      </Section>

      <Section id="sec-cobuyer" title="Segundo titular" icon={<UsersIcon size={16} />} dirty={sectionDirty("Segundo titular")}>
        <Toggle
          checked={form.hasCoBuyer}
          onChange={(v) => set("hasCoBuyer", v)}
          label="La venta tiene segundo titular"
          description={form.hasCoBuyer ? "Desactívalo para quitarlo de la venta." : "Actívalo para registrar un co-comprador."}
        />
        {form.hasCoBuyer && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <TextField label="Nombre" value={form.coBuyer.firstName} onChange={(e) => patch("coBuyer", { firstName: e.target.value })} />
            <TextField label="Apellidos" value={form.coBuyer.lastName} onChange={(e) => patch("coBuyer", { lastName: e.target.value })} />
            <TextField label="Teléfono" type="tel" value={form.coBuyer.phone} onChange={(e) => patch("coBuyer", { phone: e.target.value })} />
            <TextField label="Correo" type="email" value={form.coBuyer.email} onChange={(e) => patch("coBuyer", { email: e.target.value })} />
            <TextField label="N.º de documento" value={form.coBuyer.documentNumber} onChange={(e) => patch("coBuyer", { documentNumber: e.target.value })} />
            <TextField label="Fecha de nacimiento" type="date" value={form.coBuyer.dateOfBirth} onChange={(e) => patch("coBuyer", { dateOfBirth: e.target.value })} />
          </div>
        )}
      </Section>

      {/* ------------------------------------------------------ unidades */}
      <Section
        id="sec-units"
        title="Unidades"
        icon={<PackageIcon size={16} />}
        dirty={sectionDirty("Unidades")}
        aside={
          !structureLocked && (
            <Button
              size="sm"
              variant="secondary"
              icon={<PlusIcon size={14} />}
              onClick={() =>
                set("units", [
                  ...form.units,
                  {
                    key: tmpKey("unit"), id: null, productId: "", productName: "", variantId: "", variantLabel: "",
                    agreedPrice: "", trackingCode: null, hasCommission: false,
                    frozenFixedPriceCents: null, frozenFixedCommissionCents: null,
                  },
                ])
              }
            >
              Agregar unidad
            </Button>
          )
        }
      >
        {err("units") && <p className="mb-3 text-xs text-danger">{err("units")}</p>}
        <div className="space-y-3">
          {form.units.map((u, idx) => {
            const productLocked = isPaid || (isSold && u.hasCommission);
            const productLockReason = isPaid
              ? "Venta pagada: el producto no se modifica."
              : "La comisión de esta unidad ya se calculó al marcarla vendida.";
            return (
              <div key={u.key} className="rounded-xl border border-border bg-surface-muted p-3 sm:p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Unidad {idx + 1}
                    {u.trackingCode && <span className="ml-2 font-mono normal-case tracking-normal text-info">{u.trackingCode}</span>}
                    {!u.id && <span className="ml-2 rounded-full bg-brand-soft px-1.5 py-px text-[10px] text-brand">Nueva</span>}
                  </p>
                  {!structureLocked && (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<TrashIcon size={14} />}
                      onClick={() => set("units", form.units.filter((x) => x.key !== u.key))}
                    >
                      Quitar
                    </Button>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5 sm:col-span-2">
                    {productLocked ? (
                      <>
                        <ReadOnlyField label="Producto" value={u.productName || "—"} />
                        <LockNote>{productLockReason}</LockNote>
                      </>
                    ) : (
                      <ModelSearchSelect
                        label="Producto"
                        required
                        selectedName={u.productName}
                        error={err(`unit.${u.key}.product`)}
                        onSelect={(m) =>
                          setUnit(u.key, m
                            ? {
                                productId: m.id,
                                productName: m.name,
                                variantId: "",
                                variantLabel: "",
                                // Nuevo producto → su precio fijo como precio sugerido
                                // y su configuración para la comisión.
                                agreedPrice: isPricingConfigured(m.fixedPriceCents, m.fixedCommissionCents)
                                  ? centsToInputvalue(m.fixedPriceCents)
                                  : "",
                                fixedPriceCents: m.fixedPriceCents,
                                fixedCommissionCents: m.fixedCommissionCents,
                              }
                            : { productId: "", productName: "", variantId: "", variantLabel: "", fixedPriceCents: undefined, fixedCommissionCents: undefined })
                        }
                      />
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <VariantSelect
                      key={u.productId}
                      productId={u.productId}
                      value={u.variantId}
                      label={u.variantLabel}
                      disabled={!u.productId}
                      onChange={(variantId, variantLabel) => setUnit(u.key, { variantId, variantLabel })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <TextField
                      label="Precio de venta (USD)"
                      required
                      inputMode="decimal"
                      value={u.agreedPrice}
                      disabled={isPaid}
                      error={err(`unit.${u.key}.price`)}
                      onChange={(e) => setUnit(u.key, { agreedPrice: e.target.value.replace(/[^\d.,]/g, "") })}
                      hint={
                        isSold && u.hasCommission
                          ? "Mínimo: el precio fijo congelado. La comisión se recalcula con su snapshot original."
                          : "Nunca por debajo del precio fijo del producto."
                      }
                    />
                    {isPaid && <LockNote>Venta pagada: el precio no se modifica.</LockNote>}
                  </div>
                  <UnitCommissionPreview unit={u} />
                </div>
              </div>
            );
          })}
        </div>
        {structureLocked && (
          <div className="mt-3">
            <LockNote>
              En una venta {isPaid ? "pagada" : "vendida"} no se agregan ni quitan unidades (afecta comisión, seguimiento y
              logística).
            </LockNote>
          </div>
        )}
      </Section>

      {/* ------------------------------------------------------ extras */}
      <Section
        id="sec-extras"
        title="Extras"
        icon={<PlusIcon size={16} />}
        dirty={sectionDirty("Extras")}
        aside={
          !isPaid && (
            <Button
              size="sm"
              variant="secondary"
              icon={<PlusIcon size={14} />}
              onClick={() =>
                set("extras", [...form.extras, { key: tmpKey("extra"), id: null, description: "", quantity: "1", unitPrice: "" }])
              }
            >
              Agregar extra
            </Button>
          )
        }
      >
        {form.extras.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sin extras.</p>
        ) : (
          <div className="space-y-2.5">
            {form.extras.map((x) => (
              <div key={x.key} className="grid items-start gap-3 rounded-xl border border-border bg-surface-muted p-3 sm:grid-cols-[minmax(0,1fr)_90px_150px_auto]">
                <TextField label="Descripción" value={x.description} onChange={(e) => setExtra(x.key, { description: e.target.value })} />
                <TextField
                  label="Cantidad"
                  inputMode="numeric"
                  value={x.quantity}
                  disabled={isPaid}
                  error={err(`extra.${x.key}.quantity`)}
                  onChange={(e) => setExtra(x.key, { quantity: e.target.value.replace(/\D/g, "") })}
                />
                <TextField
                  label="Precio unitario (USD)"
                  inputMode="decimal"
                  value={x.unitPrice}
                  disabled={isPaid}
                  onChange={(e) => setExtra(x.key, { unitPrice: e.target.value.replace(/[^\d.,]/g, "") })}
                />
                {!isPaid && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="sm:mt-6"
                    icon={<TrashIcon size={14} />}
                    onClick={() => set("extras", form.extras.filter((y) => y.key !== x.key))}
                  >
                    Quitar
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
        {isPaid && (
          <div className="mt-3">
            <LockNote>Venta pagada: solo la descripción de los extras es editable.</LockNote>
          </div>
        )}
      </Section>

      {/* ------------------------------------------------------ destinatario */}
      <Section id="sec-recipient" title="Destinatario en Cuba" icon={<MapPinIcon size={16} />} dirty={sectionDirty("Destinatario")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Nombre completo" required value={form.recipient.fullName} error={err("recipient.fullName")} onChange={(e) => patch("recipient", { fullName: e.target.value })} />
          <TextField label="CI / NI" required value={form.recipient.identityNumber} error={err("recipient.identityNumber")} onChange={(e) => patch("recipient", { identityNumber: e.target.value })} />
          <TextField label="Teléfono principal" required type="tel" value={form.recipient.phonePrimary} error={err("recipient.phonePrimary")} onChange={(e) => patch("recipient", { phonePrimary: e.target.value })} />
          <TextField label="Teléfono secundario" type="tel" value={form.recipient.phoneSecondary} onChange={(e) => patch("recipient", { phoneSecondary: e.target.value })} />
          <SelectField
            label="Provincia"
            required
            placeholder="Selecciona la provincia"
            value={form.recipient.province}
            error={err("recipient.province")}
            onChange={(e) => patch("recipient", { province: e.target.value })}
            options={[
              ...CUBA_PROVINCES.map((p) => ({ value: p, label: p })),
              ...(form.recipient.province && !(CUBA_PROVINCES as readonly string[]).includes(form.recipient.province)
                ? [{ value: form.recipient.province, label: form.recipient.province }]
                : []),
            ]}
          />
          <TextField label="Municipio" value={form.recipient.municipality} onChange={(e) => patch("recipient", { municipality: e.target.value })} />
          <TextAreaField
            label="Dirección de entrega"
            required
            containerClassName="sm:col-span-2"
            className="min-h-[72px]"
            value={form.recipient.deliveryAddress}
            error={err("recipient.deliveryAddress")}
            onChange={(e) => patch("recipient", { deliveryAddress: e.target.value })}
          />
        </div>
      </Section>

      <Section id="sec-delivery" title="Entrega" icon={<TruckIcon size={16} />} dirty={sectionDirty("Entrega")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label="Método de entrega"
            required
            placeholder="Selecciona"
            value={form.delivery.method}
            error={err("delivery.method")}
            onChange={(e) => patch("delivery", { method: e.target.value })}
            options={DELIVERY_OPTIONS}
          />
          <TextField label="Referencia / punto de recogida" value={form.delivery.reference} onChange={(e) => patch("delivery", { reference: e.target.value })} />
        </div>
      </Section>

      <Section id="sec-notes" title="Notas internas" icon={<NoteIcon size={16} />} dirty={sectionDirty("Notas")}>
        <TextAreaField label="Notas" value={form.internalNotes} onChange={(e) => set("internalNotes", e.target.value)} placeholder="Observaciones internas de la venta" />
      </Section>

      {/* ------------------------------------------------ barra de guardado */}
      <div
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border-strong bg-background/95 backdrop-blur lg:left-64"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="min-w-0 flex-1 text-xs">
            <p className={cn("font-semibold", dirty ? "text-brand" : "text-muted-foreground")}>
              {dirty ? `${changes.length} cambio(s) sin guardar` : "Sin cambios"}
            </p>
            <p className="text-muted-foreground">
              Total {totalChanged ? "estimado" : "actual"}:{" "}
              <span className="font-semibold tabular-nums text-foreground">{formatCents(total)}</span>
              {totalChanged && (
                <span className="ml-1 tabular-nums">
                  (antes {formatCents(baselineTotal)}) · el servidor lo recalcula
                </span>
              )}
            </p>
          </div>
          <Button
            variant="ghost"
            onClick={() => {
              if (dirty && !window.confirm("¿Descartar los cambios sin guardar?")) return;
              setSaved(true);
              router.push(detailHref);
            }}
          >
            {dirty ? "Descartar" : "Volver"}
          </Button>
          <Button variant="primary" onClick={openConfirm} disabled={!dirty} icon={isPaid ? <ShieldIcon size={16} /> : undefined}>
            {isPaid ? "Revisar corrección" : "Guardar cambios"}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        tone={isPaid ? "danger" : financialChanges ? "warning" : "default"}
        title={confirmTitle}
        description={
          isPaid
            ? "Corrección administrativa sobre una venta PAGADA. Se conserva el historial original y queda registrada a tu nombre."
            : "Revisa los cambios. El servidor valida, recalcula y registra cada campo en la auditoría."
        }
        confirmLabel={confirmLabel}
        pendingLabel={isPaid ? "Aplicando corrección…" : "Guardando cambios…"}
        reason={
          status === "DRAFT"
            ? undefined
            : {
                label: isPaid ? "Motivo de la corrección administrativa" : "Motivo del cambio",
                placeholder: "Ej.: El cliente corrigió su número de teléfono.",
              }
        }
        acknowledge={
          isPaid
            ? "Entiendo que es una CORRECCIÓN ADMINISTRATIVA sobre una venta pagada: no cambia importes y queda registrada con mi nombre y motivo."
            : undefined
        }
        onConfirm={async (reason) => {
          const res = await adminUpdateSale({
            saleId,
            payload: toPayload(form),
            reason,
            adminCorrection: isPaid,
            expectedUpdatedAt,
          });
          if (!res.ok) {
            const list = res.code === "VALIDATION_FAILED" ? validationList(res.errors) : [];
            return {
              ok: false,
              message: list.length > 1 ? list.join(" · ") : saleControlErrorText(res.code, { errors: res.errors }),
            };
          }
          setSaved(true);
          const count = Number(res.changeCount ?? changes.length);
          toast.success(isPaid ? "Corrección administrativa aplicada." : "Venta actualizada.", `${count} cambio(s) registrados en la auditoría.`);
          const rec = res.reconciliation as { required?: boolean; differenceCents?: number } | undefined;
          if (rec?.required) {
            toast.warning(
              "Conciliación requerida",
              "El nuevo total no coincide con los pagos asignados o cobrados. Ningún pago se modificó.",
            );
          }
          if (Number(res.commissionsAdjusted ?? 0) > 0) {
            toast.info("Comisión recalculada", "Se aplicó el snapshot original de la comisión al nuevo precio.");
          }
          router.push(detailHref);
          router.refresh();
          return { ok: true };
        }}
      >
        <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-xl border border-border bg-surface-muted p-3">
          {changes.map((c, i) => (
            <div key={i} className="text-xs">
              <p className="font-semibold text-text-secondary">
                {c.section} · {c.label}
                {c.financial && <span className="ml-1.5 text-[10px] font-bold uppercase text-warning">importe</span>}
              </p>
              <p className="mt-0.5 flex flex-wrap items-center gap-1.5">
                <span className="text-muted-foreground line-through">{c.from}</span>
                <span aria-hidden="true" className="text-muted-foreground">→</span>
                <span className="font-medium text-foreground">{c.to}</span>
              </p>
            </div>
          ))}
        </div>
        {totalChanged && (
          <p className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning">
            Total {formatCents(baselineTotal)} → {formatCents(total)} (estimado). El servidor recalcula el total
            autoritativo{isSold ? " y la comisión (snapshot)" : ""}.
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}

/** Comisión de la unidad: congelada (VENDIDA, recalculada con su snapshot) o estimada con el producto actual. */
function UnitCommissionPreview({ unit }: { unit: UnitRow }) {
  if (!unit.productId) return null;
  const p = unitPricing(unit);
  if (p.fixedPriceCents === undefined) return null;
  if (!isPricingConfigured(p.fixedPriceCents, p.fixedCommissionCents)) {
    return (
      <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning sm:col-span-2">
        Este producto no tiene precio fijo de venta o comisión fija: la venta no puede enviarse ni marcarse VENDIDA.{" "}
        <Link href={`${ROUTES.adminProductos}/${unit.productId}`} className="font-semibold underline underline-offset-2">
          Configurar en la ficha del producto
        </Link>
      </p>
    );
  }
  const b = computeCommission(p.fixedPriceCents, p.fixedCommissionCents!, parseAmountToCents(unit.agreedPrice));
  if (b.belowFixedPrice) return null; // el error del campo ya lo explica
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2.5 sm:col-span-2">
      <p className="mb-2 text-xs font-medium text-foreground">
        {p.frozen ? "Comisión (snapshot congelado)" : "Comisión estimada (configuración vigente)"}
      </p>
      <CommissionBreakdownList breakdown={b} frozen={p.frozen} label={`Comisión · ${unit.productName}`} />
    </div>
  );
}
