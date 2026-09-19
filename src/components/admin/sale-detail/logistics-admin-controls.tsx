"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { TextAreaField, SelectField } from "@/components/ui/form-fields";
import {
  LOGISTICS_STATUS_LABEL,
  LOGISTICS_NEXT_STATUS,
  LOGISTICS_STATUS_OPTIONS,
  type LogisticsStatus,
  type SaleUnitLogisticsInfo,
} from "@/lib/sales/logistics-types";
import { logisticsActionErrorText } from "@/lib/admin/logistics-errors";
import { updateLogisticsStatus, correctLogisticsStatus } from "@/app/(admin)/admin/logistica/actions";
import { toast } from "@/components/ui/toast";

function AdvanceButton({ saleId, saleUnitId, next }: { saleId: string; saleUnitId: string; next: LogisticsStatus }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requiresConfirm = next === "DELIVERED";
  const [confirming, setConfirming] = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await updateLogisticsStatus(saleUnitId, next, requiresConfirm ? "Entregada al destinatario" : undefined, saleId);
    if (!res.ok) {
      setError(logisticsActionErrorText(res.code));
      setBusy(false);
      return;
    }
    setBusy(false);
    setConfirming(false);
    toast.success("Logística actualizada.");
    router.refresh();
  };

  if (requiresConfirm) {
    return (
      <>
        <Button variant="primary" size="sm" onClick={() => setConfirming(true)}>
          Confirmar entrega
        </Button>
        <Modal open={confirming} onClose={() => setConfirming(false)} title="Confirmar entrega">
          <p className="text-sm text-text-secondary">
            ¿Confirmas que esta unidad fue entregada al destinatario? Se registrará &ldquo;Entregada al destinatario&rdquo;.
          </p>
          {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={busy}>Cancelar</Button>
            <Button variant="primary" size="sm" onClick={() => void submit()} disabled={busy}>
              {busy ? "Guardando…" : "Confirmar entrega"}
            </Button>
          </div>
        </Modal>
      </>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button variant="secondary" size="sm" onClick={() => void submit()} disabled={busy}>
        {busy ? "Guardando…" : `Avanzar a ${LOGISTICS_STATUS_LABEL[next]}`}
      </Button>
      {error && <p role="alert" className="text-[11px] text-danger">{error}</p>}
    </div>
  );
}

function HoldButton({ saleId, saleUnitId }: { saleId: string; saleUnitId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    if (!reason.trim()) {
      setError("Escribe el motivo de la espera.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await updateLogisticsStatus(saleUnitId, "ON_HOLD", reason.trim(), saleId);
    if (!res.ok) {
      setError(logisticsActionErrorText(res.code));
      setBusy(false);
      return;
    }
    setBusy(false);
    setOpen(false);
    toast.success("Logística actualizada.");
    router.refresh();
  };

  return (
    <>
      <Button variant="danger" size="sm" onClick={() => setOpen(true)}>
        Poner en espera
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Poner unidad en espera">
        <TextAreaField
          label="Motivo (obligatorio)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ej.: retenida en aduana"
        />
        {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>Cancelar</Button>
          <Button variant="danger" size="sm" onClick={() => void submit()} disabled={busy}>
            {busy ? "Guardando…" : "Poner en espera"}
          </Button>
        </div>
      </Modal>
    </>
  );
}

function CorrectionButton({ saleId, saleUnitId, currentStatus }: { saleId: string; saleUnitId: string; currentStatus: LogisticsStatus }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [newStatus, setNewStatus] = useState<LogisticsStatus>(currentStatus);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    if (reason.trim().length < 4) {
      setError("Escribe un motivo (mínimo 4 caracteres).");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await correctLogisticsStatus(saleUnitId, newStatus, reason.trim(), saleId);
    if (!res.ok) {
      setError(logisticsActionErrorText(res.code));
      setBusy(false);
      return;
    }
    setBusy(false);
    setOpen(false);
    toast.success("Logística actualizada.");
    router.refresh();
  };

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Corregir estado
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Corrección auditada de logística">
        <p className="mb-3 text-xs text-muted-foreground">
          Úsalo solo para corregir un error operativo (p. ej. reanudar desde espera, o revertir un avance equivocado).
          Queda registrado como corrección, nunca se borra el historial original.
        </p>
        <div className="space-y-3">
          <SelectField
            label="Nuevo estado"
            options={LOGISTICS_STATUS_OPTIONS}
            value={newStatus}
            onChange={(e) => setNewStatus(e.target.value as LogisticsStatus)}
          />
          <TextAreaField
            label="Motivo (obligatorio)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ej.: se marcó ENTREGADA por error, sigue en tránsito"
          />
        </div>
        {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={() => void submit()} disabled={busy}>
            {busy ? "Guardando…" : "Aplicar corrección"}
          </Button>
        </div>
      </Modal>
    </>
  );
}

/** Controles de Admin para UNA unidad — avanzar / poner en espera / corregir. */
export function LogisticsAdminControls({ saleId, unit }: { saleId: string; unit: SaleUnitLogisticsInfo }) {
  const next = LOGISTICS_NEXT_STATUS[unit.status];

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {next && <AdvanceButton saleId={saleId} saleUnitId={unit.saleUnitId} next={next} />}
      {unit.status !== "DELIVERED" && unit.status !== "ON_HOLD" && (
        <HoldButton saleId={saleId} saleUnitId={unit.saleUnitId} />
      )}
      <CorrectionButton saleId={saleId} saleUnitId={unit.saleUnitId} currentStatus={unit.status} />
    </div>
  );
}
