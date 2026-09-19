"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { SelectField, TextField, TextAreaField } from "@/components/ui/form-fields";
import { parseAmountToCents } from "@/lib/money";
import { liquidationActionErrorText } from "@/lib/admin/liquidations-errors";
import { addLiquidationAdjustment } from "@/app/(admin)/admin/liquidaciones/actions";
import { toast } from "@/components/ui/toast";
import type { LiquidationAdjustmentType } from "@/lib/sales/liquidation-types";

const TYPE_OPTIONS: { value: LiquidationAdjustmentType; label: string }[] = [
  { value: "BONO_VENTAS", label: "Bono de ventas" },
  { value: "BONO_MARKETING", label: "Bono de marketing" },
  { value: "AJUSTE_POSITIVO", label: "Ajuste positivo" },
  { value: "AJUSTE_NEGATIVO", label: "Ajuste negativo" },
];

/** Bono/ajuste manual — entidad separada, nunca reescribe una comisión ya
 * calculada. Bloqueado por el backend una vez la liquidación está PAID. */
export function LiquidationAdjustmentForm({ liquidationId }: { liquidationId: string }) {
  const router = useRouter();
  const [type, setType] = useState<LiquidationAdjustmentType>("BONO_VENTAS");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    const cents = parseAmountToCents(amount);
    if (cents <= 0) {
      setError("El monto debe ser mayor a cero.");
      return;
    }
    if (!reason.trim()) {
      setError("Escribe un motivo.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await addLiquidationAdjustment(liquidationId, type, cents, reason.trim());
    if (!res.ok) {
      setError(liquidationActionErrorText(res.code));
      setBusy(false);
      return;
    }
    setAmount("");
    setReason("");
    setBusy(false);
    toast.success("Ajuste agregado a la liquidación.");
    router.refresh();
  };

  return (
    <div className="space-y-3 rounded-lg border border-dashed p-3 border-border">
      <p className="text-xs font-medium text-muted-foreground">Agregar ajuste manual</p>
      <div className="grid grid-cols-2 gap-3">
        <SelectField
          label="Tipo"
          options={TYPE_OPTIONS}
          value={type}
          onChange={(e) => setType(e.target.value as typeof type)}
        />
        <TextField
          label="Monto"
          type="number"
          min={0}
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>
      <TextAreaField
        label="Motivo"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Ej.: bono por meta de unidades del mes"
      />
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      <Button variant="secondary" size="sm" onClick={() => void submit()} disabled={busy}>
        {busy ? "Agregando…" : "Agregar ajuste"}
      </Button>
    </div>
  );
}
