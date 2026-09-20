"use client";

import { useActionState } from "react";
import { redeemInviteAction, type RedeemInviteState } from "@/app/auth/invitacion/actions";
import type { InviteTokenType } from "@/lib/invitations/invite-link-core";
import { Button } from "@/components/ui/button";

const initialState: RedeemInviteState = { error: null };

/**
 * Botón que canjea la invitación. El envío es un POST: los rastreadores que
 * abren el enlace para armar una vista previa (WhatsApp, correo) solo hacen
 * GET, así que ya no pueden gastar el token antes que la persona.
 */
export function RedeemInviteForm({
  tokenHash,
  type = "invite",
}: {
  tokenHash: string;
  type?: InviteTokenType;
}) {
  const [state, formAction, pending] = useActionState(redeemInviteAction, initialState);

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="token_hash" value={tokenHash} />
      <input type="hidden" name="type" value={type} />
      {state.error && (
        <p
          role="alert"
          className="rounded-xl border border-danger/30 bg-danger-surface px-3.5 py-3 text-sm text-danger"
        >
          {state.error}
        </p>
      )}
      <Button
        type="submit"
        variant="primary"
        size="lg"
        loading={pending}
        loadingText="ABRIENDO INVITACIÓN…"
        className="w-full uppercase"
      >
        Continuar
      </Button>
    </form>
  );
}
