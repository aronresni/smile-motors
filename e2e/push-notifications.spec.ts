import { execFileSync } from "node:child_process";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import type { Database } from "../src/types/database.types";
import { deliverPendingPush } from "../src/lib/push/dispatch-core";
import type { PushPayload, PushSendResult, PushTarget, PushTransport } from "../src/lib/push/types";
import { E2E_PASSWORD } from "./credentials";

/**
 * NOTIFICACIONES DEL TELÉFONO (Web Push) — canal de entrega sobre el sistema
 * de notificaciones que ya existía.
 *
 *  · Servicio: base REAL con cuentas SANDBOX y un transporte de CAPTURA en
 *    lugar del servicio de push (no se envía nada a ningún teléfono real).
 *    Prueba qué se entrega, a quién, cuántas veces, y qué pasa cuando falla.
 *  · Interfaz: la tarjeta de activación real, con el servicio de push del
 *    navegador simulado (en un Chromium sin conexión a FCM no hay
 *    suscripción posible) y TODO lo demás de verdad, hasta la fila en la base.
 *
 * Cada prueba borra lo que crea.
 */

const SELLER_A = "e2e-push-a@motods.test";
const SELLER_B = "e2e-push-b@motods.test";

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

type Db = SupabaseClient<Database>;
let svc: Db;
let idA: string;
let idB: string;

function seed(email: string, name: string) {
  execFileSync(
    "node",
    [
      "--env-file=.env.local",
      "supabase/scripts/create-user.mjs", "--sandbox",
      "--email", email,
      "--password", E2E_PASSWORD,
      "--role", "seller",
      "--name", name,
    ],
    { cwd: path.resolve(__dirname, ".."), stdio: "ignore" },
  );
}

async function signIn(email: string): Promise<Db> {
  const client = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
  const { error } = await client.auth.signInWithPassword({ email, password: E2E_PASSWORD });
  if (error) throw error;
  return client;
}

async function profileId(email: string): Promise<string> {
  const { data } = await svc.from("profiles").select("id, is_sandbox").eq("email", email).single();
  if (!data) throw new Error(`sin perfil: ${email}`);
  // Las pruebas SOLO actúan sobre cuentas de la partición de pruebas.
  expect(data.is_sandbox, `${email} debe ser sandbox`).toBe(true);
  return data.id;
}

/** Transporte de captura: registra lo que se enviaría, con el fallo que se le
 * pida para un endpoint concreto. */
function captureTransport(failures: Record<string, number> = {}) {
  const sent: { endpoint: string; payload: PushPayload }[] = [];
  const transport: PushTransport = {
    async send(target: PushTarget, payload: PushPayload): Promise<PushSendResult> {
      const statusCode = failures[target.endpoint];
      if (statusCode) return { ok: false, statusCode, error: `simulado ${statusCode}` };
      sent.push({ endpoint: target.endpoint, payload });
      return { ok: true };
    },
  };
  return { transport, sent };
}

const endpointFor = (tag: string) =>
  `https://push.example.test/e2e/${tag}-${Math.random().toString(36).slice(2, 10)}`;

async function register(
  client: Db,
  endpoint: string,
  label = "iPhone",
): Promise<{ ok?: boolean; code?: string }> {
  const { data, error } = await client.rpc("push_subscription_register", {
    p_endpoint: endpoint,
    p_p256dh: "BLc4xRzKlKORKWlbdgFaBrrPK3ydWAHo4M0gs0i1oEKgPpWC5cW8OCzVrOQRv-1npXRWk8udnW3oYhIO4475rds",
    p_auth: "5I2Bu2oKdyy9CwL8QVF0NQ",
    p_user_agent: "Playwright",
    p_device_label: label,
  });
  if (error) throw error;
  return data as { ok?: boolean; code?: string };
}

/** Deja al usuario sin dispositivos: cada caso parte de cero. */
async function clearDevices(...userIds: string[]) {
  for (const userId of userIds) {
    await svc.from("push_subscriptions").delete().eq("user_id", userId);
  }
}

/** Notificación de prueba escrita directamente (los triggers de dominio ya
 * tienen su propia prueba: aquí se prueba SOLO la entrega). */
async function seedNotification(recipient: string, title: string): Promise<string> {
  const { data, error } = await svc
    .from("notifications")
    .insert({
      recipient_user_id: recipient,
      type: "SALE_MARKED_SOLD",
      title,
      message: "Mensaje de prueba de entrega.",
      destination_url: "/seller/ventas",
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

test.beforeAll(async () => {
  svc = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  seed(SELLER_A, "Push A");
  seed(SELLER_B, "Push B");
  idA = await profileId(SELLER_A);
  idB = await profileId(SELLER_B);
});

test.afterAll(async () => {
  const { data } = await svc.auth.admin.listUsers({ perPage: 200 });
  for (const email of [SELLER_A, SELLER_B]) {
    const user = data.users.find((u) => u.email === email);
    if (user) await svc.auth.admin.deleteUser(user.id); // arrastra notificaciones y dispositivos
  }
});

test.describe("Servicio — entrega a los dispositivos", () => {
  test("1 · alta del dispositivo: queda a nombre de quien tiene la sesión", async () => {
    const a = await signIn(SELLER_A);
    const endpoint = endpointFor("alta");
    expect((await register(a, endpoint)).ok).toBe(true);

    const { data } = await svc
      .from("push_subscriptions")
      .select("user_id, revoked_at, device_label")
      .eq("endpoint", endpoint)
      .single();
    expect(data).toMatchObject({ user_id: idA, revoked_at: null, device_label: "iPhone" });

    // El dueño NO se puede falsear: la RPC no acepta un user_id.
    const { data: mine } = await a.from("push_subscriptions").select("endpoint");
    expect(mine?.map((r) => r.endpoint)).toContain(endpoint);
  });

  test("2 · seguridad entre vendedores: B no ve, ni da de baja, ni inserta el dispositivo de A", async () => {
    const a = await signIn(SELLER_A);
    const b = await signIn(SELLER_B);
    const endpoint = endpointFor("privado");
    await register(a, endpoint);

    // No lo ve (RLS).
    const { data: visible } = await b.from("push_subscriptions").select("endpoint");
    expect(visible?.map((r) => r.endpoint) ?? []).not.toContain(endpoint);

    // No lo da de baja.
    const { data: revoked } = await b.rpc("push_subscription_revoke", { p_endpoint: endpoint });
    expect((revoked as { revoked?: number }).revoked).toBe(0);
    const { data: still } = await svc
      .from("push_subscriptions")
      .select("user_id, revoked_at")
      .eq("endpoint", endpoint)
      .single();
    expect(still).toMatchObject({ user_id: idA, revoked_at: null });

    // No puede insertar una fila a mano (no hay política de INSERT).
    const { error } = await b
      .from("push_subscriptions")
      .insert({ user_id: idA, endpoint: endpointFor("intruso"), p256dh: "x", auth: "y" });
    expect(error).not.toBeNull();

    // Y tampoco puede mandar push: la función de reparto no está al alcance
    // de una sesión normal.
    const { error: claimError } = await b.rpc("push_claim_pending", { p_limit: 10 });
    expect(claimError).not.toBeNull();
  });

  test("3 · una notificación, varios dispositivos: una fila y una entrega por aparato", async () => {
    const a = await signIn(SELLER_A);
    await clearDevices(idA, idB);
    const iphone = endpointFor("iphone");
    const escritorio = endpointFor("escritorio");
    await register(a, iphone, "iPhone");
    await register(a, escritorio, "Mac");

    const notificationId = await seedNotification(idA, "Contrato enviado");
    const { transport, sent } = captureTransport();
    const result = await deliverPendingPush(svc, transport);

    expect(result.claimed).toBeGreaterThanOrEqual(1);
    const mine = sent.filter((s) => s.payload.id === notificationId);
    expect(mine.map((s) => s.endpoint).sort()).toEqual([escritorio, iphone].sort());

    // Una sola notificación en la base, con su contenido: nada sensible.
    const { data: rows } = await svc.from("notifications").select("id").eq("id", notificationId);
    expect(rows).toHaveLength(1);
    expect(mine[0].payload).toMatchObject({
      title: "Contrato enviado",
      body: "Mensaje de prueba de entrega.",
      url: "/seller/ventas",
    });
    expect(mine[0].payload.unread).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(mine[0].payload)).not.toContain(idA); // sin identificadores internos

    // Segunda pasada: ya está entregada, no se repite.
    const again = captureTransport();
    await deliverPendingPush(svc, again.transport);
    expect(again.sent.filter((s) => s.payload.id === notificationId)).toHaveLength(0);
  });

  test("4 · dos repartos a la vez no entregan lo mismo dos veces", async () => {
    const a = await signIn(SELLER_A);
    await clearDevices(idA, idB);
    const endpoint = endpointFor("carrera");
    await register(a, endpoint);
    const notificationId = await seedNotification(idA, "Venta confirmada");

    const first = captureTransport();
    const second = captureTransport();
    await Promise.all([
      deliverPendingPush(svc, first.transport),
      deliverPendingPush(svc, second.transport),
    ]);

    const total = [...first.sent, ...second.sent].filter((s) => s.payload.id === notificationId);
    expect(total).toHaveLength(1);
  });

  test("5 · una notificación ya leída no interrumpe el teléfono", async () => {
    const a = await signIn(SELLER_A);
    await clearDevices(idA, idB);
    const endpoint = endpointFor("leida");
    await register(a, endpoint);
    const notificationId = await seedNotification(idA, "Ya leída");
    await svc
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", notificationId);

    const { transport, sent } = captureTransport();
    await deliverPendingPush(svc, transport);
    expect(sent.filter((s) => s.payload.id === notificationId)).toHaveLength(0);
  });

  test("6 · endpoint muerto (410): se da de baja ese aparato y la notificación queda intacta", async () => {
    const a = await signIn(SELLER_A);
    await clearDevices(idA, idB);
    const muerto = endpointFor("muerto");
    const vivo = endpointFor("vivo");
    await register(a, muerto);
    await register(a, vivo);
    const notificationId = await seedNotification(idA, "Venta pagada");

    const { transport, sent } = captureTransport({ [muerto]: 410 });
    const result = await deliverPendingPush(svc, transport);

    expect(result.revoked).toBeGreaterThanOrEqual(1);
    expect(sent.map((s) => s.endpoint)).toContain(vivo); // el otro sí recibe
    const { data: dead } = await svc
      .from("push_subscriptions")
      .select("revoked_at")
      .eq("endpoint", muerto)
      .single();
    expect(dead?.revoked_at).not.toBeNull();

    // La notificación de la base —la autoridad— no se toca.
    const { data: notification } = await svc
      .from("notifications")
      .select("id, read_at")
      .eq("id", notificationId)
      .single();
    expect(notification).toMatchObject({ id: notificationId, read_at: null });

    // Y queda registrado, sin romper nada.
    const { data: errors } = await svc
      .from("notification_delivery_errors")
      .select("source, context")
      .eq("source", "push:send")
      .order("created_at", { ascending: false })
      .limit(5);
    expect(errors?.some((e) => (e.context as { notificationId?: string })?.notificationId === notificationId)).toBe(true);
  });

  test("7 · fallo temporal: NO borra el dispositivo y la operación de negocio no se entera", async () => {
    const a = await signIn(SELLER_A);
    await clearDevices(idA, idB);
    const endpoint = endpointFor("temporal");
    await register(a, endpoint);
    const notificationId = await seedNotification(idA, "Liquidación aprobada");

    const { transport } = captureTransport({ [endpoint]: 500 });
    const result = await deliverPendingPush(svc, transport); // no lanza
    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(result.revoked).toBe(0);

    const { data: alive } = await svc
      .from("push_subscriptions")
      .select("revoked_at")
      .eq("endpoint", endpoint)
      .single();
    expect(alive?.revoked_at).toBeNull(); // sigue registrado

    const { data: notification } = await svc
      .from("notifications")
      .select("id")
      .eq("id", notificationId)
      .single();
    expect(notification?.id).toBe(notificationId); // la notificación sigue ahí
  });

  test("8 · el mismo teléfono con otra cuenta: los avisos del anterior dejan de llegar", async () => {
    const a = await signIn(SELLER_A);
    const b = await signIn(SELLER_B);
    await clearDevices(idA, idB);
    const telefono = endpointFor("compartido");

    // A lo activa y luego cierra sesión (baja del aparato).
    await register(a, telefono);
    const { data: bajado } = await a.rpc("push_subscription_revoke", { p_endpoint: telefono });
    expect((bajado as { revoked?: number }).revoked).toBe(1);

    const notificacionDeA = await seedNotification(idA, "Para A tras cerrar sesión");
    const tras = captureTransport();
    await deliverPendingPush(svc, tras.transport);
    expect(tras.sent.filter((s) => s.endpoint === telefono)).toHaveLength(0);

    // Ahora entra B en ese mismo teléfono: el aparato pasa a ser suyo.
    await register(b, telefono);
    const { data: owner } = await svc
      .from("push_subscriptions")
      .select("user_id, revoked_at")
      .eq("endpoint", telefono)
      .single();
    expect(owner).toMatchObject({ user_id: idB, revoked_at: null });

    // Una notificación NUEVA de A tampoco llega a ese teléfono.
    const otraDeA = await seedNotification(idA, "Otra para A");
    const despues = captureTransport();
    await deliverPendingPush(svc, despues.transport);
    expect(despues.sent.filter((s) => s.endpoint === telefono && s.payload.id === otraDeA)).toHaveLength(0);
    expect(despues.sent.filter((s) => s.payload.id === notificacionDeA && s.endpoint === telefono)).toHaveLength(0);

    // Pero la de B sí.
    const deB = await seedNotification(idB, "Para B");
    const paraB = captureTransport();
    await deliverPendingPush(svc, paraB.transport);
    expect(paraB.sent.filter((s) => s.endpoint === telefono && s.payload.id === deB)).toHaveLength(1);
  });

  test("9 · la entrega nunca sale de la partición de pruebas", async () => {
    await clearDevices(idA, idB);
    const { data: realDevices } = await svc
      .from("push_subscriptions")
      .select("id, user_id, last_used_at, profiles!inner(is_sandbox)")
      .eq("profiles.is_sandbox", false);
    const before = JSON.stringify(realDevices ?? []);

    await seedNotification(idA, "Aislamiento");
    const { transport, sent } = captureTransport();
    await deliverPendingPush(svc, transport);

    // Todo lo entregado pertenece a cuentas sandbox.
    const endpoints = sent.map((s) => s.endpoint);
    if (endpoints.length) {
      const { data: owners } = await svc
        .from("push_subscriptions")
        .select("endpoint, profiles!inner(is_sandbox)")
        .in("endpoint", endpoints);
      for (const row of owners ?? []) {
        expect((row.profiles as unknown as { is_sandbox: boolean }).is_sandbox, row.endpoint).toBe(true);
      }
    }

    const { data: realAfter } = await svc
      .from("push_subscriptions")
      .select("id, user_id, last_used_at, profiles!inner(is_sandbox)")
      .eq("profiles.is_sandbox", false);
    expect(JSON.stringify(realAfter ?? [])).toBe(before); // ningún aparato real tocado
  });
});

/* ------------------------------------------------------------------ */
/* Interfaz                                                            */
/* ------------------------------------------------------------------ */

/** Simula el servicio de push del navegador (Chromium sin FCM no puede
 * suscribirse de verdad). Todo lo demás —permiso, service worker, acción de
 * servidor y fila en la base— es real. */
async function fakePushService(page: Page, endpoint: string) {
  await page.addInitScript(
    ({ endpoint }) => {
      const subscription = {
        endpoint,
        toJSON: () => ({ endpoint, keys: { p256dh: "BLc4xRzKlKORKWlbdgFaBrrPK3ydWAHo4M0gs0i1oEKgPpWC5cW8OCzVrOQRv-1npXRWk8udnW3oYhIO4475rds", auth: "5I2Bu2oKdyy9CwL8QVF0NQ" } }),
        unsubscribe: async () => true,
      };
      let current: unknown = null;
      const manager = {
        getSubscription: async () => current,
        subscribe: async () => {
          current = subscription;
          return subscription;
        },
      };
      const registration = { pushManager: manager, scope: "/" };
      Object.defineProperty(navigator, "serviceWorker", {
        configurable: true,
        value: {
          register: async () => registration,
          getRegistration: async () => registration,
          ready: Promise.resolve(registration),
          addEventListener: () => {},
        },
      });
      (window as unknown as { __permissionCalls: number }).__permissionCalls = 0;
      Object.defineProperty(window, "Notification", {
        configurable: true,
        value: Object.assign(
          function () {} as unknown as typeof window.Notification,
          {
            permission: "default",
            requestPermission: async () => {
              (window as unknown as { __permissionCalls: number }).__permissionCalls++;
              Object.defineProperty(window.Notification, "permission", { value: "granted", configurable: true });
              return "granted" as NotificationPermission;
            },
          },
        ),
      });
    },
    { endpoint },
  );
}

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.getByRole("button", { name: /iniciar sesión/i }).click();
  await page.waitForURL(/\/seller/, { timeout: 20_000 });
}

test.describe("Interfaz — activar desde el teléfono", () => {
  test("10 · nunca se pide el permiso al cargar; solo al tocar el botón, y el alta llega a la base", async ({
    page,
  }) => {
    await clearDevices(idA);
    const endpoint = endpointFor("ui");
    await fakePushService(page, endpoint);
    await login(page, SELLER_A);
    await page.goto("/seller/notificaciones");

    const card = page.locator("section, div").filter({ hasText: "Notificaciones del teléfono" }).first();
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("No activadas en este dispositivo.")).toBeVisible();

    // NADIE pidió permiso al abrir la página.
    expect(await page.evaluate(() => (window as unknown as { __permissionCalls: number }).__permissionCalls)).toBe(0);

    await page.getByRole("button", { name: "Activar notificaciones" }).click();
    await expect(page.getByText("Activadas en este dispositivo.")).toBeVisible({ timeout: 20_000 });
    expect(await page.evaluate(() => (window as unknown as { __permissionCalls: number }).__permissionCalls)).toBe(1);

    // Y el dispositivo quedó guardado para ESE vendedor.
    await expect
      .poll(async () => {
        const { data } = await svc
          .from("push_subscriptions")
          .select("endpoint, revoked_at")
          .eq("user_id", idA)
          .is("revoked_at", null);
        return (data ?? []).map((row) => row.endpoint);
      }, { timeout: 15_000, message: "esperando el alta del dispositivo" })
      .toEqual([endpoint]);

    // Desactivar lo da de baja.
    await page.getByRole("button", { name: "Desactivar" }).click();
    await expect(page.getByText("No activadas en este dispositivo.")).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(async () => {
        const { data } = await svc
          .from("push_subscriptions")
          .select("revoked_at")
          .eq("endpoint", endpoint)
          .single();
        return data?.revoked_at !== null;
      }, { timeout: 15_000, message: "esperando la baja del dispositivo" })
      .toBe(true);
  });

  test("11 · iPhone sin instalar: explica cómo hacerlo en vez de ofrecer un botón que no serviría", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "userAgent", {
        configurable: true,
        get: () =>
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      });
    });
    await login(page, SELLER_A);
    await page.goto("/seller/notificaciones");

    await expect(page.getByText("Falta instalar Smile Motors en la pantalla de inicio.")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Añadir a pantalla de inicio/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Activar notificaciones" })).toHaveCount(0);
  });

  test("12 · permiso denegado: lo dice y no vuelve a pedirlo", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window.Notification, "permission", { value: "denied", configurable: true });
    });
    await login(page, SELLER_A);
    await page.goto("/seller/notificaciones");

    await expect(page.getByText("Las notificaciones están bloqueadas en este dispositivo.")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Activar notificaciones" })).toHaveCount(0);
  });

  test("13 · el service worker se sirve y solo se ocupa del push (sin caché de datos)", async ({ page, request }) => {
    const res = await request.get("/sw.js");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("javascript");
    const source = await res.text();
    expect(source).toContain('addEventListener("push"');
    expect(source).toContain('addEventListener("notificationclick"');
    // Nada de interceptar peticiones: los datos de ventas nunca se sirven
    // desde una copia vieja.
    expect(source).not.toContain('addEventListener("fetch"');
    expect(source).not.toContain("caches.open");

    await login(page, SELLER_A);
    const registered = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      return Boolean(reg);
    });
    expect(registered).toBe(true);
  });

  test("14 · la insignia del icono sigue al contador real de no leídas", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __badge: (number | null)[] }).__badge = [];
      Object.defineProperty(navigator, "setAppBadge", {
        configurable: true,
        value: async (n?: number) => {
          (window as unknown as { __badge: (number | null)[] }).__badge.push(n ?? 0);
        },
      });
      Object.defineProperty(navigator, "clearAppBadge", {
        configurable: true,
        value: async () => {
          (window as unknown as { __badge: (number | null)[] }).__badge.push(null);
        },
      });
    });

    await seedNotification(idA, "Para la insignia");
    await login(page, SELLER_A);
    await page.goto("/seller/notificaciones");

    const { data: unread } = await svc
      .from("notifications")
      .select("id")
      .eq("recipient_user_id", idA)
      .is("read_at", null);
    const expected = (unread ?? []).length;
    expect(expected).toBeGreaterThan(0);

    await expect
      .poll(async () => page.evaluate(() => (window as unknown as { __badge: (number | null)[] }).__badge.at(-1)), {
        timeout: 20_000,
      })
      .toBe(expected);

    // Al marcarlas todas como leídas, la insignia se quita.
    await page.getByRole("button", { name: /marcar todas/i }).first().click();
    await expect
      .poll(async () => page.evaluate(() => (window as unknown as { __badge: (number | null)[] }).__badge.at(-1)), {
        timeout: 20_000,
      })
      .toBeNull();
  });
});
