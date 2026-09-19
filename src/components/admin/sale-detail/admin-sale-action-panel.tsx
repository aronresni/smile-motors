"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, buttonClasses } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmResult } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  FileTextIcon,
  HistoryIcon,
  PencilIcon,
  ShieldIcon,
} from "@/components/ui/icons";
import { formatCents } from "@/lib/money";
import { saleControlErrorText } from "@/lib/admin/sale-control-errors";
import {
  adminConfirmClosing,
  adminMarkPaid,
  adminMarkSold,
  adminReturnToDraft,
  adminSendToReview,
  type AdminRpcResult,
} from "@/app/(admin)/admin/ventas/[saleId]/actions";

type Dialog = null | "review" | "sold" | "return" | "paid" | "closing";

export interface ActionPanelProps {
  saleId: string;
  status: string;
  editHref: string;
  saleTotalCents: number;
  collectedCents: number;
  outstandingCents: number;
  readyForPaid: boolean;
  /** Proveedores con contrato obligatorio aún sin firmar (cálculo informativo;
   * la RPC vuelve a validarlo contra los contratos reales). */
  unsignedRequiredProviders: string[];
  hasFinancing: boolean;
  reconciliationRequired: boolean;
  pendingEditRequestHref: string | null;
}

function toResult(res: AdminRpcResult, success: string): ConfirmResult {
  if (!res.ok) {
    return {
      ok: false,
      message: saleControlErrorText(res.code, { providers: res.providers, errors: res.errors }),
    };
  }
  toast.success(success);
  return { ok: true };
}

/**
 * ACCIONES de la venta (Admin): solo las transiciones posibles en el estado
 * actual, cada una con confirmación que explica qué va a pasar. Nunca un
 * `<select>` de estado: flujos explícitos, validados en el servidor.
 */
export function AdminSaleActionPanel(p: ActionPanelProps) {
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog>(null);
  const close = () => setDialog(null);
  const done = (r: ConfirmResult) => {
    if (r.ok) router.refresh();
    return r;
  };

  const blockedSold = p.status === "PENDING" && p.unsignedRequiredProviders.length > 0;

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Acciones</h2>
        <span className="inline-flex items-center gap-1 rounded-full border border-brand/35 bg-brand-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand">
          <ShieldIcon size={12} /> Admin
        </span>
      </div>

      <div className="space-y-2.5">
        {/* ---- transición principal según estado ---- */}
        {p.status === "DRAFT" && (
          <Button variant="primary" className="w-full" onClick={() => setDialog("review")} icon={<ArrowRightIcon size={16} />}>
            Enviar a revisión
          </Button>
        )}

        {p.status === "PENDING" && (
          <>
            <Button
              variant="primary"
              className="w-full"
              onClick={() => setDialog("sold")}
              disabled={blockedSold}
              icon={<CheckCircleIcon size={16} />}
            >
              Marcar como vendida
            </Button>
            {blockedSold && (
              <p className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning">
                Falta firmar el contrato de {p.unsignedRequiredProviders.join(", ")}. La autoridad del admin no omite
                este requisito.
              </p>
            )}
          </>
        )}

        {p.status === "SOLD" && (
          <>
            <Button
              variant="primary"
              className="w-full"
              onClick={() => setDialog("paid")}
              disabled={!p.readyForPaid}
              icon={<CheckCircleIcon size={16} />}
            >
              Marcar como pagada
            </Button>
            {!p.readyForPaid && (
              <p className="text-xs text-muted-foreground">
                {p.reconciliationRequired
                  ? "Bloqueada: el cobro no coincide exactamente con el total (requiere conciliación)."
                  : `Falta cobrar ${formatCents(p.outstandingCents)} para poder marcarla como pagada.`}
              </p>
            )}
          </>
        )}

        {/* ---- editar / corregir ---- */}
        {p.status !== "CANCELLED" && (
          <Link
            href={p.editHref}
            className={buttonClasses(p.status === "DRAFT" ? "secondary" : "secondary", "md", "w-full")}
          >
            {p.status === "PAID" ? <ShieldIcon size={16} /> : <PencilIcon size={16} />}
            {p.status === "PAID" ? "Corrección administrativa" : "Editar venta"}
          </Link>
        )}
        {p.status === "SOLD" && (
          <p className="text-[11px] text-muted-foreground">
            Venta vendida: cada corrección exige motivo, queda auditada y recalcula totales y comisión.
          </p>
        )}
        {p.status === "PAID" && (
          <p className="text-[11px] text-muted-foreground">
            Venta pagada: solo datos no financieros, con motivo y confirmación. El historial original se conserva.
          </p>
        )}

        {p.status === "PENDING" && (
          <Button variant="danger" className="w-full" onClick={() => setDialog("return")}>
            Devolver a borrador
          </Button>
        )}
        {p.status === "SOLD" && !p.readyForPaid && (
          <Button variant="ghost" className="w-full" onClick={() => setDialog("closing")}>
            Registrar cierre pendiente a cobrar
          </Button>
        )}

        {p.pendingEditRequestHref && (
          <Link
            href={p.pendingEditRequestHref}
            className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning hover:bg-warning/15"
          >
            <AlertTriangleIcon size={14} className="mt-px shrink-0" />
            El vendedor tiene una solicitud de edición pendiente. Revisarla →
          </Link>
        )}
      </div>

      {/* ---- totales ---- */}
      <dl className="mt-4 space-y-1.5 border-t border-border pt-3 text-sm">
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Total venta</dt>
          <dd className="font-semibold tabular-nums text-foreground">{formatCents(p.saleTotalCents)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Cobrado / acreditado</dt>
          <dd className="tabular-nums text-success">{formatCents(p.collectedCents)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Pendiente</dt>
          <dd className={p.outstandingCents > 0 ? "tabular-nums text-warning" : "tabular-nums text-success"}>
            {formatCents(p.outstandingCents)}
          </dd>
        </div>
      </dl>

      {/* ---- accesos a secciones ---- */}
      <div className="mt-4 grid gap-1.5 border-t border-border pt-3">
        {p.hasFinancing && (
          <a href="#contratos" className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-elevated hover:text-foreground">
            <FileTextIcon size={15} /> Ver / gestionar contratos
          </a>
        )}
        <a href="#historial" className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-elevated hover:text-foreground">
          <HistoryIcon size={15} /> Historial y auditoría
        </a>
      </div>

      {/* ---- confirmaciones ---- */}
      <ConfirmDialog
        open={dialog === "review"}
        onClose={close}
        title="Enviar la venta a revisión"
        description="La venta pasa de BORRADOR a PENDIENTE como acción administrativa."
        consequences={[
          "Se validan todos los datos obligatorios y la cobertura exacta de los pagos.",
          "El vendedor ya no podrá editarla libremente (las ediciones pasan por aprobación).",
          "Queda registrado en el historial a tu nombre.",
        ]}
        confirmLabel="Enviar a revisión"
        pendingLabel="Enviando a revisión…"
        onConfirm={async () => done(toResult(await adminSendToReview(p.saleId), "Venta enviada a revisión."))}
      />

      <ConfirmDialog
        open={dialog === "sold"}
        onClose={close}
        title="Marcar la venta como VENDIDA"
        description="Acción administrativa con las mismas validaciones que el vendedor: contratos obligatorios firmados, datos completos y comisión del producto configurada."
        consequences={[
          "Se genera el número de venta y el código de seguimiento de cada unidad.",
          "Se calcula y congela la comisión del vendedor (snapshot).",
          "Se inicia la logística de cada unidad (seguimiento y entrega) y comienza el cobro.",
        ]}
        confirmLabel="Marcar como vendida"
        pendingLabel="Marcando como vendida…"
        onConfirm={async () => done(toResult(await adminMarkSold(p.saleId), "Venta marcada como vendida."))}
      />

      <ConfirmDialog
        open={dialog === "return"}
        onClose={close}
        tone="danger"
        title="Devolver la venta a borrador"
        description="El vendedor podrá corregirla y volver a enviarla a revisión."
        consequences={["La venta vuelve a BORRADOR.", "El motivo queda visible para el vendedor y en el historial."]}
        reason={{ label: "Motivo de la devolución", placeholder: "Ej.: Falta el documento del destinatario." }}
        confirmLabel="Devolver a borrador"
        pendingLabel="Devolviendo…"
        onConfirm={async (reason) => done(toResult(await adminReturnToDraft(p.saleId, reason), "Venta devuelta a borrador."))}
      />

      <ConfirmDialog
        open={dialog === "paid"}
        onClose={close}
        title="Marcar la venta como PAGADA"
        description="El servidor vuelve a verificar que lo cobrado/acreditado coincide EXACTAMENTE con el total."
        consequences={[
          `Total ${formatCents(p.saleTotalCents)} · cobrado ${formatCents(p.collectedCents)}.`,
          "Las comisiones pendientes de esta venta pasan a ELEGIBLES para la próxima liquidación.",
          "Queda registrada a tu nombre y no puede deshacerse desde aquí.",
        ]}
        confirmLabel="Marcar como pagada"
        pendingLabel="Marcando como pagada…"
        onConfirm={async () => done(toResult(await adminMarkPaid(p.saleId), "Venta marcada como pagada."))}
      />

      <ConfirmDialog
        open={dialog === "closing"}
        onClose={close}
        title="Registrar cierre pendiente a cobrar"
        description="Registra tu revisión del cierre. La venta sigue VENDIDA con cobro pendiente — no cambia su estado."
        confirmLabel="Registrar cierre"
        pendingLabel="Registrando…"
        onConfirm={async () => done(toResult(await adminConfirmClosing(p.saleId), "Cierre registrado: pendiente a cobrar."))}
      />
    </div>
  );
}
