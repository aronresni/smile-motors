"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/form-fields";
import { toast } from "@/components/ui/toast";
import { CommissionBreakdownList } from "@/components/commission/commission-breakdown";
import { computeCommission, isPricingConfigured } from "@/lib/commission";
import { formatCents, parseMoneyInputStrict } from "@/lib/money";
import { commissionActionErrorText } from "@/lib/admin/commissions-errors";
import { updateProductCommissionDefaults } from "@/app/(admin)/admin/comisiones/actions";

function storedToInput(cents: number | null): string {
  return cents == null ? "" : (cents / 100).toFixed(2);
}

type FieldErrors = { price?: string; commission?: string };

/** Validación de la ficha (el servidor repite exactamente las mismas reglas). */
function validateFixedValues(priceText: string, commissionText: string) {
  const errors: FieldErrors = {};
  const price = parseMoneyInputStrict(priceText);
  const commission = parseMoneyInputStrict(commissionText);
  if (!priceText.trim()) errors.price = "Completa el precio fijo de venta.";
  else if (price == null) errors.price = "Escribe un importe válido (por ejemplo 4500 o 4,500.00).";
  else if (price <= 0) errors.price = "El precio fijo de venta debe ser mayor que $0.";
  if (!commissionText.trim()) errors.commission = "Completa la comisión fija.";
  else if (commission == null) errors.commission = "Escribe un importe válido (por ejemplo 500 o 500.00).";
  else if (commission <= 0) errors.commission = "La comisión fija debe ser mayor que $0.";
  if (!errors.price && !errors.commission && commission! >= price!) {
    errors.commission = "La comisión fija debe ser menor que el precio fijo de venta.";
  }
  return { errors, price, commission };
}

/** Código del servidor → campo al que pertenece el error. */
const SERVER_FIELD: Record<string, keyof FieldErrors> = {
  FIXED_PRICE_REQUIRED: "price",
  FIXED_PRICE_INVALID: "price",
  FIXED_COMMISSION_REQUIRED: "commission",
  FIXED_COMMISSION_INVALID: "commission",
  FIXED_COMMISSION_TOO_HIGH: "commission",
};

/**
 * PRECIO FIJO DE VENTA + COMISIÓN FIJA del producto. Solo un administrador
 * los edita (aquí). El precio fijo es el mínimo oficial: el vendedor puede
 * vender por encima (la diferencia se reparte a partes iguales con la tienda),
 * nunca por debajo. Se congelan en cada venta al marcarla VENDIDA, así que
 * cambiarlos solo afecta a ventas futuras.
 */
export function ProductCommissionDefaults({
  productId,
  defaultReferencePriceCents,
  defaultBaseCommissionCents,
}: {
  productId: string;
  defaultReferencePriceCents: number | null;
  defaultBaseCommissionCents: number | null;
}) {
  const router = useRouter();
  const [priceText, setPriceText] = useState(storedToInput(defaultReferencePriceCents));
  const [commissionText, setCommissionText] = useState(storedToInput(defaultBaseCommissionCents));
  const [sampleText, setSampleText] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const configured = isPricingConfigured(defaultReferencePriceCents, defaultBaseCommissionCents);
  const check = validateFixedValues(priceText, commissionText);
  const shown: FieldErrors = {
    price: serverErrors.price ?? (attempted ? check.errors.price : undefined),
    commission: serverErrors.commission ?? (attempted ? check.errors.commission : undefined),
  };
  const valid = Object.keys(check.errors).length === 0;

  // Simulador: con los valores escritos (si son válidos). Sin precio simulado,
  // usa el precio fijo.
  const sampleCents = sampleText.trim() ? parseMoneyInputStrict(sampleText) : valid ? check.price : null;
  const simulation =
    valid && sampleCents != null ? computeCommission(check.price!, check.commission!, sampleCents) : null;

  const submit = async () => {
    if (busy) return;
    setAttempted(true);
    setServerErrors({});
    setFormError(null);
    if (!valid) return;
    setBusy(true);
    const res = await updateProductCommissionDefaults(productId, check.price!, check.commission!);
    setBusy(false);
    if (!res.ok) {
      const field = res.code ? SERVER_FIELD[res.code] : undefined;
      if (field) setServerErrors({ [field]: commissionActionErrorText(res.code) });
      else setFormError(commissionActionErrorText(res.code));
      return;
    }
    toast.success("Precio fijo y comisión guardados.", "Se aplicarán a las ventas que pasen a VENDIDA desde ahora.");
    router.refresh();
  };

  return (
    <div className="space-y-3">
      {!configured && (
        <p className="rounded-lg border px-3 py-2 text-xs border-warning/30 bg-warning/10 text-warning">
          Sin configurar: una venta de este producto no podrá enviarse ni marcarse VENDIDA hasta definir el precio fijo
          de venta y la comisión fija.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label="Precio fijo de venta (USD)"
          required
          inputMode="decimal"
          placeholder="4500.00"
          value={priceText}
          error={shown.price}
          hint="Precio mínimo oficial. El vendedor puede vender por encima, nunca por debajo."
          onChange={(e) => {
            setPriceText(e.target.value.replace(/[^\d.,$]/g, ""));
            setServerErrors((s) => ({ ...s, price: undefined }));
          }}
        />
        <TextField
          label="Comisión fija (USD)"
          required
          inputMode="decimal"
          placeholder="500.00"
          value={commissionText}
          error={shown.commission}
          hint="Lo que cobra el vendedor al vender exactamente al precio fijo."
          onChange={(e) => {
            setCommissionText(e.target.value.replace(/[^\d.,$]/g, ""));
            setServerErrors((s) => ({ ...s, commission: undefined }));
          }}
        />
      </div>

      <div className="space-y-2.5 rounded-xl border border-border bg-surface-muted px-3.5 py-3 text-xs text-text-secondary">
        <p className="font-medium text-foreground">Simulador de comisión</p>
        <p>
          Si se vende por encima del precio fijo, el adicional se reparte a partes iguales entre el vendedor y la tienda
          (el centavo impar queda para la tienda). Comisión total = comisión fija + mitad del adicional.
        </p>
        <TextField
          label="Simular precio de venta (USD)"
          inputMode="decimal"
          placeholder={check.price ? (check.price / 100).toFixed(2) : "4700.00"}
          value={sampleText}
          onChange={(e) => setSampleText(e.target.value.replace(/[^\d.,$]/g, ""))}
          containerClassName="max-w-56"
        />
        {!valid ? (
          <p className="text-muted-foreground">Completa el precio fijo y la comisión fija para simular.</p>
        ) : sampleCents == null ? (
          <p className="text-danger">Escribe un precio de venta válido.</p>
        ) : simulation?.belowFixedPrice ? (
          <p role="status" className="text-danger">
            No se permite vender por debajo del precio fijo ({formatCents(check.price!)}).
          </p>
        ) : (
          simulation && <CommissionBreakdownList breakdown={simulation} label="Simulación de comisión" />
        )}
      </div>

      {formError && <p role="alert" className="text-xs text-danger">{formError}</p>}
      <Button variant="primary" size="sm" onClick={() => void submit()} loading={busy} loadingText="Guardando…">
        Guardar precio fijo y comisión
      </Button>
    </div>
  );
}
