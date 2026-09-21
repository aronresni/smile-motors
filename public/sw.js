/*
 * Service worker de Smile Motors.
 *
 * Existe SOLO para las notificaciones push: recibirlas con la app cerrada y
 * abrir la pantalla correcta al tocarlas.
 *
 * A propósito NO intercepta `fetch` ni guarda nada en caché: esta app muestra
 * ventas, contratos, cobros y comisiones en vivo, y servir una copia vieja de
 * esos datos sería peor que no funcionar.
 */

const APP_ICON = "/icons/icon-512.png";

self.addEventListener("install", () => {
  // Una versión nueva no espera a que se cierren las pestañas viejas.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/** ¿Hay una ventana de la app a la vista ahora mismo? */
async function appIsVisible() {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  return windows.some((client) => client.visibilityState === "visible");
}

async function updateBadge(unread) {
  if (typeof unread !== "number") return;
  try {
    if (unread > 0) await self.navigator.setAppBadge?.(unread);
    else await self.navigator.clearAppBadge?.();
  } catch {
    /* La insignia no está en todas las plataformas; no es crítica. */
  }
}

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let data = {};
      try {
        data = event.data ? event.data.json() : {};
      } catch {
        data = {};
      }

      const title = data.title || "Smile Motors";
      const body = data.body || "";
      // Si la persona está usando la app, ya vio el aviso dentro (Realtime):
      // el del sistema entra sin sonido ni vibración, solo queda en el centro
      // de notificaciones. El estándar obliga a mostrar SIEMPRE algo visible,
      // así que no se suprime: se hace discreto.
      const visible = await appIsVisible();

      await self.registration.showNotification(title, {
        body,
        // Una misma notificación nunca apila dos avisos.
        tag: data.id || undefined,
        renotify: false,
        silent: visible,
        icon: APP_ICON,
        data: { url: data.url || "/", id: data.id || null },
      });

      await updateBadge(data.unread);
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Si la app ya está abierta, se reutiliza esa ventana.
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.focus();
        if ("navigate" in client) {
          try {
            await client.navigate(url);
          } catch {
            /* Algunos navegadores no dejan navegar una ventana ajena. */
          }
        }
        return;
      }
      // Si no, se abre. Sin sesión, el propio servidor lleva al login
      // conservando el destino; nada del contenido se ve antes de entrar.
      await self.clients.openWindow(url);
    })(),
  );
});

/* El navegador puede rotar el endpoint por su cuenta. No se reintenta aquí:
 * el envío fallido da 410, el servidor da de baja ese dispositivo y la app
 * vuelve a registrarlo la próxima vez que se abre (ver `push-toggle.tsx`). */
self.addEventListener("pushsubscriptionchange", () => {
  /* intencionadamente vacío */
});
