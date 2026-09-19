"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { TextField } from "@/components/ui/form-fields";
import { sellerActionErrorText } from "@/lib/admin/seller-errors";
import { inviteSeller } from "@/app/(admin)/admin/vendedores/actions";
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
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const close = () => {
    if (busy) return;
    setOpen(false);
    setForm(EMPTY);
    setError(null);
    setSuccess(false);
  };

  const submit = async () => {
    if (busy) return;
    if (!form.firstName.trim() || !form.lastName.trim() || !form.email.trim()) {
      setError("Completa nombre, apellido y correo.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await inviteSeller({
      firstName: form.firstName,
      lastName: form.lastName,
      email: form.email,
      phone: form.phone || undefined,
    });
    if (!res.ok) {
      setError(sellerActionErrorText(res.code));
      setBusy(false);
      return;
    }
    setBusy(false);
    setSuccess(true);
    toast.success("Invitación enviada.");
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
        description="Se le enviará un correo con un enlace seguro para fijar su propia contraseña. Nunca se le asigna una contraseña desde aquí."
        footer={
          success ? (
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
        {success ? (
          <p className="rounded-lg bg-success/10 px-3 py-2 text-sm text-success">
            Invitación enviada. Aparecerá como &quot;Invitado&quot; hasta que el vendedor la acepte.
          </p>
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
