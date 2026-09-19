"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { TextAreaField } from "@/components/ui/form-fields";
import { sellerActionErrorText } from "@/lib/admin/seller-errors";
import type { SellerAccountStatus } from "@/lib/admin/sellers";
import {
  cancelSellerInvitation,
  disableSeller,
  reactivateSeller,
  resendSellerInvitation,
  suspendSeller,
} from "@/app/(admin)/admin/vendedores/actions";
import { InviteLinkBox } from "@/components/admin/sellers/invite-link-box";
import { toast } from "@/components/ui/toast";

/** Acciones administrativas de la ficha de un vendedor — una por estado,
 * cada una con su propia confirmación; ninguna transición ocurre sin pasar
 * por la RPC correspondiente (nunca solo deshabilitar un botón). */
export function SellerDetailActions({
  sellerId,
  accountStatus,
  phone,
}: {
  sellerId: string;
  accountStatus: SellerAccountStatus;
  /** Para el atajo de WhatsApp al reenviar la invitación. */
  phone?: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [reason, setReason] = useState("");

  const run = async (
    fn: () => Promise<{ ok: boolean; code?: string; inviteUrl?: unknown }>,
    onDone?: () => void,
    success?: string,
  ) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await fn();
    if (!res.ok) {
      setError(sellerActionErrorText(res.code));
      setBusy(false);
      return;
    }
    setBusy(false);
    setInviteUrl(typeof res.inviteUrl === "string" ? res.inviteUrl : null);
    onDone?.();
    if (success) toast.success(success);
    router.refresh();
  };

  return (
    <div className="space-y-2">
      {error && (
        <p role="alert" className="rounded-lg px-3 py-2 text-xs bg-danger/10 text-danger">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {accountStatus === "INVITED" && (
          <>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => void run(() => resendSellerInvitation(sellerId), undefined, "Enlace nuevo generado.")}>
              Reenviar invitación
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={busy}
              onClick={() => {
                if (confirm("¿Cancelar esta invitación? La cuenta quedará deshabilitada.")) {
                  void run(() => cancelSellerInvitation(sellerId), undefined, "Invitación cancelada.");
                }
              }}
            >
              Cancelar invitación
            </Button>
          </>
        )}

        {accountStatus === "ACTIVE" && (
          <Button variant="danger" size="sm" disabled={busy} onClick={() => setSuspendOpen(true)}>
            Suspender
          </Button>
        )}

        {accountStatus === "SUSPENDED" && (
          <>
            <Button variant="primary" size="sm" disabled={busy} onClick={() => void run(() => reactivateSeller(sellerId), undefined, "Vendedor reactivado.")}>
              Reactivar
            </Button>
            <Button variant="danger" size="sm" disabled={busy} onClick={() => setDisableOpen(true)}>
              Deshabilitar
            </Button>
          </>
        )}
      </div>

      {inviteUrl && (
        <InviteLinkBox
          url={inviteUrl}
          phone={phone ?? undefined}
          className="rounded-xl border border-border bg-surface p-3"
        />
      )}

      <Modal
        open={suspendOpen}
        onClose={() => !busy && setSuspendOpen(false)}
        title="Suspender vendedor"
        description="El vendedor perderá acceso inmediatamente, incluso con sesión iniciada. Sus ventas históricas se conservan intactas."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setSuspendOpen(false)} disabled={busy}>Cancelar</Button>
            <Button
              variant="danger"
              size="sm"
              disabled={busy}
              onClick={() => void run(() => suspendSeller(sellerId, reason), () => { setSuspendOpen(false); setReason(""); }, "Vendedor suspendido.")}
            >
              {busy ? "Procesando…" : "Suspender"}
            </Button>
          </>
        }
      >
        <TextAreaField
          label="Motivo (opcional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ej.: Pendiente de verificación de documentos"
        />
      </Modal>

      <Modal
        open={disableOpen}
        onClose={() => !busy && setDisableOpen(false)}
        title="Deshabilitar vendedor"
        description="Distinto de suspender: se usa para cerrar la cuenta de forma más definitiva. Las ventas históricas se conservan; la cuenta nunca se borra."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setDisableOpen(false)} disabled={busy}>Cancelar</Button>
            <Button
              variant="danger"
              size="sm"
              disabled={busy}
              onClick={() => void run(() => disableSeller(sellerId, reason), () => { setDisableOpen(false); setReason(""); }, "Vendedor deshabilitado.")}
            >
              {busy ? "Procesando…" : "Deshabilitar"}
            </Button>
          </>
        }
      >
        <TextAreaField
          label="Motivo (opcional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Modal>
    </div>
  );
}
