"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { TextField } from "@/components/ui/form-fields";
import { formatBps } from "@/lib/payments/fee-engine";
import { financingActionErrorText } from "@/lib/admin/financing-errors";
import type { AdminProviderPlan } from "@/lib/admin/financing";
import {
  createPlan,
  reorderPlans,
  setPlanActive,
  updatePlan,
} from "@/app/(admin)/admin/financieras/actions";

interface PlanFormState {
  label: string;
  termMonths: string;
  feePercent: string;
}

function emptyPlanForm(): PlanFormState {
  return { label: "", termMonths: "", feePercent: "" };
}
function fromPlan(p: AdminProviderPlan): PlanFormState {
  return {
    label: p.label,
    termMonths: p.termMonths != null ? String(p.termMonths) : "",
    feePercent: String(p.feeBps / 100),
  };
}

function PlanFormModal({
  providerId,
  plan,
  open,
  onClose,
  onSaved,
}: {
  providerId: string;
  plan: AdminProviderPlan | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<PlanFormState>(plan ? fromPlan(plan) : emptyPlanForm());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reinicia el formulario cada vez que se abre (crear vs. editar otro plan).
  const key = `${open}-${plan?.id ?? "new"}`;
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setForm(plan ? fromPlan(plan) : emptyPlanForm());
    setError(null);
  }

  const submit = async () => {
    if (busy) return;
    if (!form.label.trim()) {
      setError("El nombre del plan es obligatorio.");
      return;
    }
    const feePercent = Number.parseFloat(form.feePercent);
    if (!Number.isFinite(feePercent) || feePercent < 0) {
      setError("La comisión del plan debe ser un número válido.");
      return;
    }
    const termMonths = form.termMonths.trim() ? Number.parseInt(form.termMonths, 10) : undefined;
    setBusy(true);
    setError(null);
    const feeBps = Math.round(feePercent * 100);
    const res = plan
      ? await updatePlan({ planId: plan.id, providerId, label: form.label.trim(), termMonths, feeBps })
      : await createPlan({ providerId, label: form.label.trim(), termMonths, feeBps });
    if (!res.ok) {
      setError(financingActionErrorText(res.code));
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
      title={plan ? `Editar plan: ${plan.label}` : "Nuevo plan"}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={() => void submit()} disabled={busy}>
            {busy ? "Guardando…" : plan ? "Guardar" : "Crear plan"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <TextField
          label="Etiqueta"
          required
          value={form.label}
          onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
          placeholder="Ej.: 24 Meses"
        />
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Plazo (meses, opcional)"
            type="number"
            min={0}
            value={form.termMonths}
            onChange={(e) => setForm((f) => ({ ...f, termMonths: e.target.value }))}
          />
          <TextField
            label="Comisión del plan (%)"
            type="number"
            min={0}
            step="0.01"
            required
            value={form.feePercent}
            onChange={(e) => setForm((f) => ({ ...f, feePercent: e.target.value }))}
          />
        </div>
        {plan && plan.salesUsingCount > 0 && (
          <p className="text-[11px] text-muted-foreground">
            Este plan ya se usó en {plan.salesUsingCount} venta(s). Los cambios aquí son la configuración ACTUAL —
            las ventas ya registradas conservan el fee/plazo con el que se crearon.
          </p>
        )}
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </div>
    </Modal>
  );
}

function PlanRow({
  plan,
  providerId,
  onEdit,
  moveUp,
  moveDown,
  isFirst,
  isLast,
}: {
  plan: AdminProviderPlan;
  providerId: string;
  onEdit: () => void;
  moveUp: () => void;
  moveDown: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    if (busy) return;
    if (
      plan.isActive &&
      !confirm(`¿Desactivar el plan "${plan.label}"? Dejará de ser seleccionable en ventas nuevas.`)
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    const res = await setPlanActive(plan.id, providerId, !plan.isActive);
    if (!res.ok) setError(financingActionErrorText(res.code));
    setBusy(false);
    router.refresh();
  };

  return (
    <tr className="border-b last:border-0 border-border/70">
      <td className="px-3 py-2 align-top">
        <div className="flex items-center gap-1">
          <div className="flex flex-col">
            <button
              type="button"
              disabled={isFirst}
              onClick={moveUp}
              aria-label="Subir"
              className="leading-none text-muted-foreground disabled:opacity-20 hover:text-foreground"
            >
              ▲
            </button>
            <button
              type="button"
              disabled={isLast}
              onClick={moveDown}
              aria-label="Bajar"
              className="leading-none text-muted-foreground disabled:opacity-20 hover:text-foreground"
            >
              ▼
            </button>
          </div>
          <span className="font-medium">{plan.label}</span>
        </div>
      </td>
      <td className="px-3 py-2 align-top text-text-secondary">
        {plan.termMonths ? `${plan.termMonths} meses` : "—"}
      </td>
      <td className="px-3 py-2 align-top text-text-secondary">{formatBps(plan.feeBps)}</td>
      <td className="px-3 py-2 align-top">
        <span
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            plan.isActive
              ? "border-success/30 bg-success/10 text-success"
              : "border-border bg-surface-muted text-muted-foreground"
          }`}
        >
          {plan.isActive ? "Activo" : "Inactivo"}
        </span>
      </td>
      <td className="px-3 py-2 text-right align-top tabular-nums">{plan.salesUsingCount}</td>
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
                plan.isActive
                  ? "border-danger/30 text-danger hover:bg-danger/10"
                  : "border-border hover:bg-surface-elevated"
              }`}
            >
              {plan.isActive ? "Desactivar" : "Activar"}
            </button>
          </div>
          {error && <p className="text-[10px] text-danger">{error}</p>}
        </div>
      </td>
    </tr>
  );
}

export function PlanManager({ providerId, plans }: { providerId: string; plans: AdminProviderPlan[] }) {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<AdminProviderPlan | null>(null);
  const [reorderError, setReorderError] = useState<string | null>(null);
  const sorted = [...plans].sort((a, b) => a.position - b.position);

  const openCreate = () => {
    setEditingPlan(null);
    setModalOpen(true);
  };
  const openEdit = (plan: AdminProviderPlan) => {
    setEditingPlan(plan);
    setModalOpen(true);
  };
  const onSaved = () => {
    setModalOpen(false);
    router.refresh();
  };

  const move = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= sorted.length) return;
    const next = [...sorted];
    [next[index], next[target]] = [next[target], next[index]];
    setReorderError(null);
    const res = await reorderPlans(providerId, next.map((p) => p.id));
    if (!res.ok) setReorderError(financingActionErrorText(res.code));
    router.refresh();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {sorted.length === 0 ? "Sin planes configurados." : `${sorted.length} plan(es).`}
        </p>
        <Button variant="secondary" size="sm" onClick={openCreate}>Agregar plan</Button>
      </div>

      {reorderError && <p className="text-xs text-danger">{reorderError}</p>}

      {sorted.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground border-border bg-surface">
                  <th className="px-3 py-2 font-medium">Plan</th>
                  <th className="px-3 py-2 font-medium">Plazo</th>
                  <th className="px-3 py-2 font-medium">Comisión</th>
                  <th className="px-3 py-2 font-medium">Estado</th>
                  <th className="px-3 py-2 text-right font-medium">Uso</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((plan, i) => (
                  <PlanRow
                    key={plan.id}
                    plan={plan}
                    providerId={providerId}
                    onEdit={() => openEdit(plan)}
                    moveUp={() => void move(i, -1)}
                    moveDown={() => void move(i, 1)}
                    isFirst={i === 0}
                    isLast={i === sorted.length - 1}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <PlanFormModal
        providerId={providerId}
        plan={editingPlan}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={onSaved}
      />
    </div>
  );
}
