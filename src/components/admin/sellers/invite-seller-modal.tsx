"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { TextField } from "@/components/ui/form-fields";
import { sellerActionErrorText } from "@/lib/admin/seller-errors";
import { inviteSeller } from "@/app/(admin)/admin/vendedores/actions";
import { InviteLinkBox, type InviteEmailStatus } from "@/components/admin/sellers/invite-link-box";
import { toast } from "@/components/ui/toast";

const EMPTY = { firstName: "", lastName: "", email: "", phone: "" };

/** "INVITAR VENDEDOR" — modal. El rol siempre es `seller`; este formulario
 * simple no permite invitar administradores. */
/** `defaultOpen`: abre el modal al cargar (acción rápida `?nuevo=1`). */
export function InviteSellerModal({ defaultOpen = false }: { defaultOpen?: boolean } = {}) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<{
    url: string;
    sellerId: string;
    emailStatus?: InviteEmailStatus;
    emailCode?: string;
  } | null>(null);

  const close = () => {
    if (busy) return;
    setOpen(false);
    setForm(EMPTY);
    setError(null);
    setInvite(null);
  };

  const submit = async () => {
    // Un clic = una invitación: el ref corta el segundo clic de un doble clic
    // antes de que el botón se deshabilite (cada envío generaría otro enlace).
    if (busy || inFlight.current) return;
    if (!form.firstName.trim() || !form.lastName.trim() || !form.email.trim()) {
      setError("Completa nombre, apellido y correo.");
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const res = await inviteSeller({
      firstName: form.firstName,
      lastName: form.lastName,
      email: form.email,
      phone: form.phone || undefined,
    }).finally(() => {
      inFlight.current = false;
    });
    if (!res.ok) {
      setError(sellerActionErrorText(res.code));
      setBusy(false);
      return;
    }
    setBusy(false);
    const emailStatus = res.emailStatus as InviteEmailStatus | undefined;
    setInvite({
      url: String(res.inviteUrl ?? ""),
      sellerId: String(res.sellerId ?? ""),
      emailStatus,
      emailCode: res.emailCode as string | undefined,
    });
    toast.success(emailStatus === "SENT" ? "Invitación enviada por correo." : "Invitación creada.");
    router.refresh();
  };

  return (
    <>
      <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
        Invitar vendedor
      </Button>

      <Modal
        open={open}
        onClose={close}
        title="Invitar vendedor"
        description="Se crea la cuenta, se genera un enlace seguro para que el vendedor ponga su propia contraseña y se le envía por correo. Nunca se le asigna una contraseña desde aquí."
        footer={
          invite ? (
            <Button variant="primary" size="sm" onClick={close}>
              Cerrar
            </Button>
          ) : (
            <>
              <Button variant="secondary" size="sm" onClick={close} disabled={busy}>
                Cancelar
              </Button>
              <Button variant="primary" size="sm" onClick={() => void submit()} disabled={busy}>
                {busy ? "Enviando…" : "Enviar invitación"}
              </Button>
            </>
          )
        }
      >
        {invite ? (
          <div className="space-y-3">
            <InviteLinkBox
              url={invite.url}
              sellerId={invite.sellerId}
              firstName={form.firstName}
              phone={form.phone}
              emailStatus={invite.emailStatus}
              emailCode={invite.emailCode}
            />
            <p className="text-[11px] text-muted-foreground">
              Al abrir el enlace, el vendedor crea su contraseña y ya entra con
              su correo. Figura como &quot;Invitado&quot; hasta que lo haga.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <TextField
                label="Nombre/s"
                required
                value={form.firstName}
                onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
              />
              <TextField
                label="Apellido/s"
                required
                value={form.lastName}
                onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
              />
            </div>
            <TextField
              label="Correo electrónico"
              type="email"
              required
              autoComplete="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
            <TextField
              label="Teléfono (opcional)"
              type="tel"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            />
            <p className="text-[11px] text-muted-foreground">Rol: Vendedor (fijo en este formulario).</p>
            {error && (
              <p role="alert" className="text-xs text-danger">
                {error}
              </p>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
