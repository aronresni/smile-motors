"use client";

import { useActionState } from "react";
import { TextField, ReadOnlyField } from "@/components/ui/form-fields";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ActorIdentity } from "@/components/ui/actor-identity";
import { ROLES } from "@/lib/constants";
import { updateMyAdminProfile, type ProfileFormResult } from "@/app/(admin)/admin/perfil/actions";

const initialState: ProfileFormResult = { ok: false };

/**
 * Perfil del administrador. Lo que se escribe aquí es lo que verán el resto
 * de pantallas cuando esta persona apruebe, confirme o corrija algo.
 *
 * Correo, rol y estado de la cuenta se muestran, pero no se editan: el correo
 * lo gobierna la autenticación y los otros dos solo los cambia otro
 * administrador desde la gestión de cuentas.
 */
export function AdminProfileForm({
  firstName,
  lastName,
  displayName,
  phone,
  email,
  accountStatus,
  preview,
}: {
  firstName: string;
  lastName: string;
  displayName: string;
  phone: string;
  email: string | null;
  accountStatus: string;
  preview: string | null;
}) {
  const [state, formAction, pending] = useActionState(updateMyAdminProfile, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <Card className="space-y-4">
        <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
          <ActorIdentity name={preview} role={ROLES.ADMIN} />
          <span className="rounded-full border border-brand/40 bg-brand-soft px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-brand">
            Administrador
          </span>
        </div>

        {state.error && (
          <p role="alert" className="rounded-xl border border-danger/30 bg-danger-surface px-3.5 py-3 text-sm text-danger">
            {state.error}
          </p>
        )}
        {state.ok && (
          <p role="status" className="rounded-xl border border-success/30 bg-success/10 px-3.5 py-3 text-sm text-success">
            Perfil actualizado. Tu nombre ya aparece en todo lo que hagas.
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Nombre" name="firstName" required defaultValue={firstName} autoComplete="given-name" />
          <TextField label="Apellido" name="lastName" defaultValue={lastName} autoComplete="family-name" />
        </div>
        <TextField
          label="Nombre visible"
          name="displayName"
          defaultValue={displayName}
          placeholder="Cómo querés que te vean (opcional)"
          hint="Si lo dejás vacío se usa tu nombre y apellido."
        />
        <TextField label="Teléfono" name="phone" type="tel" inputMode="tel" defaultValue={phone} autoComplete="tel" />

        <div className="grid gap-3 sm:grid-cols-2">
          <ReadOnlyField label="Correo electrónico" value={email ?? "—"} />
          <ReadOnlyField label="Estado de la cuenta" value={accountStatus} />
        </div>
      </Card>

      <Button type="submit" variant="primary" size="lg" loading={pending} loadingText="GUARDANDO…" className="uppercase">
        Guardar perfil
      </Button>
    </form>
  );
}
