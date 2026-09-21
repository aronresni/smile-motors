"use client";

import { useRef, type FormEvent, type ReactNode } from "react";
import { ROUTES } from "@/lib/constants";

/**
 * Botón de cierre de sesión. Es un `<form>` que hace POST a la route de
 * signout — sigue funcionando sin JavaScript. Único para admin y vendedor.
 *
 * Con JavaScript, antes de salir da de baja este dispositivo de las
 * notificaciones push: si luego entra otra persona en el mismo teléfono, no
 * puede recibir los avisos de quien se fue. Si eso falla o tarda, el cierre
 * de sesión sigue adelante igual — nunca deja a nadie atrapado dentro.
 */
const REVOKE_TIMEOUT_MS = 1_500;

async function revokeThisDevice(): Promise<void> {
  const { existingRegistration } = await import("@/lib/push/client");
  const registration = await existingRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe().catch(() => false);
  const { revokePushSubscription } = await import("@/lib/push/actions");
  await revokePushSubscription(endpoint);
}

export function LogoutButton({
  className,
  children,
  label = "Cerrar sesión",
  iconOnly = false,
}: {
  className?: string;
  children?: ReactNode;
  label?: string;
  /** Solo icono: el texto queda como etiqueta accesible. */
  iconOnly?: boolean;
}) {
  const submitting = useRef(false);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (submitting.current) return; // ya estamos saliendo
    event.preventDefault();
    const form = event.currentTarget;
    const timeout = new Promise((resolve) => setTimeout(resolve, REVOKE_TIMEOUT_MS));
    void Promise.race([revokeThisDevice().catch(() => undefined), timeout]).finally(() => {
      submitting.current = true;
      form.requestSubmit();
    });
  };

  return (
    <form action={ROUTES.signOut} method="post" onSubmit={handleSubmit}>
      <button
        type="submit"
        aria-label={iconOnly ? label : undefined}
        title={iconOnly ? label : undefined}
        className={
          className ??
          "rounded-xl border border-border-strong px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-elevated hover:text-foreground"
        }
      >
        {children ?? label}
      </button>
    </form>
  );
}
