/**
 * Ayudantes de navegador para las notificaciones del teléfono.
 *
 * Nada de esto pide permiso por su cuenta: el permiso SOLO se pide desde el
 * botón (`push-toggle.tsx`). iOS además exige que la app esté instalada en la
 * pantalla de inicio, así que aquí se detecta para poder explicarlo en vez de
 * ofrecer un botón que no haría nada.
 */

export const SERVICE_WORKER_URL = "/sw.js";

export type PushSupport = "supported" | "ios-needs-install" | "unsupported";

export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  // iPadOS se presenta como Mac: se distingue porque es táctil.
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone;
  return window.matchMedia("(display-mode: standalone)").matches || iosStandalone === true;
}

/** Qué se puede ofrecer en ESTE dispositivo. */
export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  const hasApi =
    "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  // En iPhone, el navegador solo expone Push cuando la app está instalada.
  if (!hasApi) return isIos() && !isStandalone() ? "ios-needs-install" : "unsupported";
  if (isIos() && !isStandalone()) return "ios-needs-install";
  return "supported";
}

export function permissionState(): NotificationPermission | null {
  if (typeof window === "undefined" || !("Notification" in window)) return null;
  return Notification.permission;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: "/" });
  } catch {
    return null;
  }
}

/** Registro ya existente (no registra uno nuevo). */
export async function existingRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return (await navigator.serviceWorker.getRegistration(SERVICE_WORKER_URL)) ?? null;
  } catch {
    return null;
  }
}

export interface SubscriptionKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export function toKeys(subscription: PushSubscription): SubscriptionKeys | null {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) return null;
  return { endpoint: json.endpoint, p256dh, auth };
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(normalized);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

/** Suscribe este dispositivo. Debe llamarse DESPUÉS de conceder el permiso. */
export async function subscribeDevice(
  registration: ServiceWorkerRegistration,
  vapidPublicKey: string,
): Promise<PushSubscription> {
  const existing = await registration.pushManager.getSubscription();
  if (existing) return existing;
  return registration.pushManager.subscribe({
    // Obligatorio: cada push muestra algo visible. Es también lo que iOS exige.
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
  });
}

/** Etiqueta corta y sin datos personales, para que el usuario reconozca el
 * dispositivo en la lista. */
export function deviceLabel(): string {
  if (typeof navigator === "undefined") return "Dispositivo";
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1))
    return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  return "Dispositivo";
}
