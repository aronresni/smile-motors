"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { registerPushSubscription, revokePushSubscription } from "@/lib/push/actions";
import {
  deviceLabel,
  existingRegistration,
  permissionState,
  pushSupport,
  registerServiceWorker,
  subscribeDevice,
  toKeys,
  type PushSupport,
} from "@/lib/push/client";

type Status =
  | "loading"
  | "off" // se puede activar
  | "on" // activadas en este dispositivo
  | "blocked" // el navegador tiene el permiso denegado
  | "ios-needs-install"
  | "unsupported"
  | "not-configured";

/**
 * Notificaciones del teléfono, por dispositivo.
 *
 * El permiso se pide SOLO al tocar el botón: el navegador (y iOS en
 * particular) exige un gesto de la persona, y pedirlo al cargar la página es
 * la forma más rápida de que lo denieguen para siempre.
 */
export function PushToggle({ vapidPublicKey }: { vapidPublicKey: string | null }) {
  const [status, setStatus] = useState<Status>("loading");
  const [support, setSupport] = useState<PushSupport>("unsupported");
  const [busy, setBusy] = useState(false);

  // Se mira el dispositivo una vez montado (todo esto necesita `window`) y se
  // asienta el estado de una sola vez, ya fuera del render.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const detected = await Promise.resolve(vapidPublicKey ? pushSupport() : "unsupported");
      if (cancelled) return;

      if (!vapidPublicKey) {
        setStatus("not-configured");
        return;
      }
      setSupport(detected);
      if (detected !== "supported") {
        setStatus(detected === "ios-needs-install" ? "ios-needs-install" : "unsupported");
        return;
      }
      if (permissionState() === "denied") {
        setStatus("blocked");
        return;
      }

      const registration = await existingRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (cancelled) return;
      setStatus(subscription ? "on" : "off");
    })();
    return () => {
      cancelled = true;
    };
  }, [vapidPublicKey]);

  const enable = async () => {
    if (!vapidPublicKey || busy) return;
    setBusy(true);
    try {
      // 1. Permiso — siempre a partir de este toque.
      const permission = await Notification.requestPermission();
      if (permission === "denied") {
        setStatus("blocked");
        return;
      }
      if (permission !== "granted") return;

      // 2. Service worker + suscripción del dispositivo.
      const registration = (await registerServiceWorker()) ?? (await existingRegistration());
      if (!registration) {
        toast.error("No pudimos preparar las notificaciones en este dispositivo.");
        return;
      }
      await navigator.serviceWorker.ready;
      const subscription = await subscribeDevice(registration, vapidPublicKey);
      const keys = toKeys(subscription);
      if (!keys) {
        toast.error("Este dispositivo no entregó una suscripción válida.");
        return;
      }

      // 3. Alta en el servidor (el dueño lo decide la sesión, no el cliente).
      const result = await registerPushSubscription({
        ...keys,
        userAgent: navigator.userAgent,
        deviceLabel: deviceLabel(),
      });
      if (!result.ok) {
        toast.error("No pudimos guardar este dispositivo. Inténtalo de nuevo.");
        return;
      }
      setStatus("on");
      toast.success("Notificaciones activadas en este dispositivo.");
    } catch {
      toast.error("No pudimos activar las notificaciones.");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const registration = await existingRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe().catch(() => false);
        await revokePushSubscription(endpoint);
      }
      setStatus("off");
      toast.success("Este dispositivo ya no recibirá notificaciones.");
    } catch {
      toast.error("No pudimos desactivar las notificaciones.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">Notificaciones del teléfono</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            <StatusLine status={status} support={support} />
          </p>
        </div>
        <Action status={status} busy={busy} onEnable={enable} onDisable={disable} />
      </div>
      <Help status={status} />
    </Card>
  );
}

function StatusLine({ status, support }: { status: Status; support: PushSupport }) {
  switch (status) {
    case "loading":
      return <>Comprobando este dispositivo…</>;
    case "on":
      return <>Activadas en este dispositivo.</>;
    case "off":
      return <>No activadas en este dispositivo.</>;
    case "blocked":
      return <>Las notificaciones están bloqueadas en este dispositivo.</>;
    case "ios-needs-install":
      return <>Falta instalar Smile Motors en la pantalla de inicio.</>;
    case "not-configured":
      return <>El envío de notificaciones aún no está configurado.</>;
    default:
      return support === "unsupported" ? (
        <>Este navegador no admite notificaciones.</>
      ) : (
        <>No disponibles aquí.</>
      );
  }
}

function Action({
  status,
  busy,
  onEnable,
  onDisable,
}: {
  status: Status;
  busy: boolean;
  onEnable: () => void;
  onDisable: () => void;
}) {
  if (status === "on") {
    return (
      <Button variant="secondary" size="sm" onClick={onDisable} loading={busy}>
        Desactivar
      </Button>
    );
  }
  if (status === "off") {
    return (
      <Button variant="primary" size="sm" onClick={onEnable} loading={busy} className="uppercase">
        Activar notificaciones
      </Button>
    );
  }
  return null;
}

function Help({ status }: { status: Status }) {
  if (status === "ios-needs-install") {
    return (
      <ol className="space-y-1 rounded-xl border border-border bg-surface-muted p-3 text-xs text-text-secondary">
        <li>1. Toca Compartir en Safari y elige «Añadir a pantalla de inicio».</li>
        <li>2. Abre Smile Motors desde ese icono nuevo.</li>
        <li>3. Vuelve aquí y toca «Activar notificaciones».</li>
      </ol>
    );
  }
  if (status === "blocked") {
    return (
      <p className="rounded-xl border border-border bg-surface-muted p-3 text-xs text-text-secondary">
        Para volver a permitirlas en iPhone: Ajustes → Notificaciones → Smile Motors → Permitir
        notificaciones. En un ordenador, con el candado de la barra de direcciones.
      </p>
    );
  }
  if (status === "off") {
    return (
      <p className="text-xs text-muted-foreground">
        Avisamos de lo mismo que ves en la campana, también con la app cerrada. Se activan en cada
        dispositivo por separado.
      </p>
    );
  }
  return null;
}
