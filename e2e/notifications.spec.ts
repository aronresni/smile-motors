import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { createTestProduct, deleteTestProducts, EXAMPLE_PRICING } from "../supabase/scripts/fixtures/commission-test-products.mjs";
import { E2E_PASSWORD } from "./credentials";

/**
 * NOTIFICACIONES — interfaz con DOS sesiones: el vendedor tiene la app
 * abierta en el navegador y administración actúa desde OTRA sesión (su
 * propio cliente autenticado). Sin recargar: aparece el toast, sube el
 * contador y la notificación está en la campana. También: leer una (3 → 2),
 * "marcar todas" (→ 0), panel a pantalla completa en móvil y el lado admin.
 *
 * Crea y borra sus propios datos (producto y ventas de prueba; las
 * notificaciones se borran con las ventas).
 */

const ADMIN_EMAIL = "e2e-smile-admin@motods.test";
const SELLER_EMAIL = "e2e-smile-seller@motods.test";
const ZELLE = "2ab4abc7-f6a4-41a9-84b0-e0d2d0668fce";
const SYNCHRONY = "68800b33-efb0-4e62-9a68-b4b65ef5657c"; // SYNCHRONY NUEVO MUEBLES
const SYNCHRONY_12M = "c2a9c2c8-af98-4c31-9d3b-7a9e9dad9070";

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

type Api = { c: SupabaseClient; id: string };
let svc: SupabaseClient;
let admin: Api;
let seller: Api;
const created = { sales: [] as string[], products: [] as string[] };
let product: { productId: string; variantId: string };
const stamp = Date.now().toString(36).toUpperCase();

async function signIn(email: string): Promise<Api> {
  const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });
  const { data, error } = await c.auth.signInWithPassword({ email, password: E2E_PASSWORD });
  if (error) throw error;
  return { c, id: data.user!.id };
}

async function rpc<T = Record<string, unknown>>(api: Api, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await api.c.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

/** Venta PENDIENTE del vendedor de prueba (con financiamiento si se pide). */
async function pendingSale(buyer: string, financing = false): Promise<string> {
  const { data: saleId } = await seller.c.rpc("create_sale_draft", { p_operation_type: "CUBA" });
  created.sales.push(saleId as string);
  await rpc(seller, "save_cuba_sale_draft", {
    p_sale_id: saleId,
    p_payload: {
      saleDate: new Date().toISOString().slice(0, 10), shareCommission: false, internalNotes: "Venta de prueba de notificaciones (UI)",
      buyer: {
        firstName: "E2E", lastName: `${buyer} ${stamp}`, dateOfBirth: "1990-01-01", documentNumber: "E2E-NUI-1",
        documentExpiration: "2031-01-01", phone: "(305) 555-0109", email: "", addressLine1: "1 Test St",
        addressLine2: "", city: "Miami", state: "FL", postalCode: "33101",
      },
      coBuyer: null,
      units: [{ productId: product.productId, variantId: product.variantId, agreedPriceCents: 470000 }],
      extras: [],
      cubaRecipient: {
        fullName: "Destinatario E2E", identityNumber: "90010112345", deliveryAddress: "Calle 1 #2",
        municipality: "Plaza", province: "La Habana", phonePrimary: "+53 55555555", phoneSecondary: "",
      },
      delivery: { method: "HOME_DELIVERY", reference: "" },
      paymentAllocations: [
        financing
          ? { id: null, paymentMethodId: SYNCHRONY, planId: SYNCHRONY_12M, inputMode: "NET", amountCents: 470000, reference: "E2E", notes: "" }
          : { id: null, paymentMethodId: ZELLE, planId: null, inputMode: "NET", amountCents: 470000, reference: "E2E", notes: "" },
      ],
    },
  });
  for (const [subject, side] of [["BUYER", "FRONT"], ["BUYER", "BACK"], ["CUBA_RECIPIENT", "FRONT"], ["CUBA_RECIPIENT", "BACK"]]) {
    await seller.c.rpc("record_sale_document", {
      p_sale_id: saleId, p_subject_type: subject, p_side: side,
      p_storage_path: `${seller.id}/${saleId}/${subject.toLowerCase()}-${side.toLowerCase()}.jpg`, p_mime_type: "image/jpeg", p_file_size_bytes: 1000,
    });
  }
  const review = await rpc<{ ok: boolean }>(seller, "request_sale_review", { p_sale_id: saleId });
  if (!review.ok) throw new Error(`review: ${JSON.stringify(review)}`);
  return saleId as string;
}

async function login(page: Page, email: string, home: RegExp, { waitLive = true } = {}) {
  await page.request.post("/auth/signout");
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: /iniciar sesión/i }).click();
  await page.waitForURL(home, { timeout: 30_000 });
  // La campana queda "en vivo" cuando el canal Realtime está suscrito.
  if (waitLive) {
    await expect(page.getByTestId("notification-bell")).toHaveAttribute("data-live", "true", { timeout: 20_000 });
  }
}

const badge = (page: Page) => page.getByTestId("notification-badge");
async function unreadOnBadge(page: Page): Promise<number> {
  if (!(await badge(page).isVisible())) return 0;
  return Number((await badge(page).innerText()).replace("+", ""));
}

test.beforeAll(async () => {
  svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  admin = await signIn(ADMIN_EMAIL);
  seller = await signIn(SELLER_EMAIL);
  product = await createTestProduct(admin.c, { name: `E2E NOTIF UI ${stamp}`, pricing: EXAMPLE_PRICING });
  created.products.push(product.productId);
  // Punto de partida conocido: el vendedor y el admin sin no leídas.
  await rpc(seller, "notification_mark_all_read");
  await rpc(admin, "notification_mark_all_read");
});

test.afterAll(async () => {
  for (const id of created.sales) await svc.from("sales").delete().eq("id", id);
  await deleteTestProducts(svc, created.products);
});

test("12 · Realtime: admin envía un contrato desde otra sesión → toast + contador + campana, sin recargar", async ({ page }) => {
  const saleId = await pendingSale("Realtime", true);
  await login(page, SELLER_EMAIL, /\/seller$/);
  await expect(badge(page)).toHaveCount(0);

  const { data: alloc } = await svc.from("sale_payment_allocations").select("id").eq("sale_id", saleId).single();
  const sent = await rpc<{ ok: boolean }>(admin, "mark_financing_sent", { p_sale_id: saleId, p_payment_allocation_id: alloc!.id });
  expect(sent.ok).toBe(true);

  // Toast pequeño y descartable, con el proveedor como contexto.
  const toastCard = page.getByRole("status").filter({ hasText: "Contrato enviado" });
  await expect(toastCard).toBeVisible({ timeout: 20_000 });
  await expect(toastCard).toContainText("SYNCHRONY NUEVO MUEBLES");
  await expect(badge(page)).toHaveText("1");

  await page.getByTestId("notification-bell").click();
  const first = page.getByTestId("notifications-panel").getByTestId("notification-row").first();
  await expect(first).toContainText("Contrato enviado");
  await expect(first).toHaveAttribute("data-unread", "true");
});

test("11 · carrera inicial de Realtime: lo que llega ANTES de conectar se recupera una vez (sin toast ni doble conteo, en orden)", async ({ page }) => {
  await rpc(seller, "notification_mark_all_read");
  const saleId = await pendingSale("Carrera", true);

  // Toasts vistos en cualquier momento (cada toast es un <li role=status> nuevo).
  await page.addInitScript(() => {
    const seen = new WeakSet<Element>();
    (window as unknown as { __toasts: string[] }).__toasts = [];
    new MutationObserver(() => {
      document.querySelectorAll('li[role="status"]').forEach((el) => {
        if (seen.has(el)) return;
        seen.add(el);
        (window as unknown as { __toasts: string[] }).__toasts.push(el.textContent ?? "");
      });
    }).observe(document, { subtree: true, childList: true });
  });
  // Realtime bloqueado hasta que la notificación ya exista en la base.
  let allowRealtime = false;
  await page.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
    if (!allowRealtime) {
      ws.close();
      return;
    }
    ws.connectToServer();
  });

  await login(page, SELLER_EMAIL, /\/seller$/, { waitLive: false });
  await expect(page.getByTestId("notification-bell")).toHaveAttribute("data-live", "false");
  const { data: alloc } = await svc.from("sale_payment_allocations").select("id").eq("sale_id", saleId).single();
  const { contractId } = await rpc<{ contractId: string }>(admin, "mark_financing_sent", { p_sale_id: saleId, p_payment_allocation_id: alloc!.id });

  allowRealtime = true;
  await expect(page.getByTestId("notification-bell")).toHaveAttribute("data-live", "true", { timeout: 60_000 });
  await expect(badge(page)).toHaveText("1"); // recuperada desde la base al conectar
  await page.waitForTimeout(1500);
  await expect(badge(page)).toHaveText("1"); // …y no se cuenta dos veces

  // Ahora un evento EN VIVO: un toast y el contador exacto.
  await rpc(admin, "mark_financing_signed", { p_contract_id: contractId });
  await expect(page.getByRole("status").filter({ hasText: "Contrato firmado" })).toBeVisible({ timeout: 20_000 });
  await expect(badge(page)).toHaveText("2");
  await page.waitForTimeout(1500);
  await expect(badge(page)).toHaveText("2");

  const toasts = await page.evaluate(() => (window as unknown as { __toasts: string[] }).__toasts);
  expect(toasts.filter((t) => t.includes("Contrato enviado")), "sin toast para lo recuperado al conectar").toHaveLength(0);
  expect(toasts.filter((t) => t.includes("Contrato firmado")), "un solo toast por notificación en vivo").toHaveLength(1);

  await page.getByTestId("notification-bell").click();
  const rows = page.getByTestId("notifications-panel").getByTestId("notification-row");
  await expect(rows.nth(0)).toContainText("Contrato firmado");
  await expect(rows.nth(1)).toContainText("Contrato enviado");
});

test("10 + 11 · leer una (3 → 2) navega a su destino; 'Marcar todas como leídas' → 0", async ({ page }) => {
  await rpc(seller, "notification_mark_all_read");
  const s1 = await pendingSale("Lectura 1", true);
  const s2 = await pendingSale("Lectura 2");
  const { data: alloc } = await svc.from("sale_payment_allocations").select("id").eq("sale_id", s1).single();
  const { contractId } = await rpc<{ contractId: string }>(admin, "mark_financing_sent", { p_sale_id: s1, p_payment_allocation_id: alloc!.id });
  await rpc(admin, "mark_financing_signed", { p_contract_id: contractId });
  await rpc(admin, "return_sale_to_draft", { p_sale_id: s2, p_reason: "Revisar el documento" });

  await login(page, SELLER_EMAIL, /\/seller$/);
  await expect(badge(page)).toHaveText("3");

  await page.getByTestId("notification-bell").click();
  // La NO leída (puede haber otra "Contrato firmado" ya leída de una prueba anterior).
  await page
    .getByTestId("notifications-panel")
    .locator('[data-testid="notification-row"][data-unread="true"]')
    .filter({ hasText: "Contrato firmado" })
    .click();
  await page.waitForURL(new RegExp(`/seller/ventas/${s1}`), { timeout: 30_000 });
  await expect(badge(page)).toHaveText("2");

  await page.goto("/seller/notificaciones");
  await expect(page.getByRole("heading", { name: "Notificaciones" })).toBeVisible();
  await expect(page.getByTestId("notification-list").getByTestId("notification-row").filter({ hasText: "Venta devuelta" })).toContainText("Motivo: Revisar el documento");
  await page.getByRole("button", { name: "Marcar todas como leídas" }).click();
  await expect(badge(page)).toHaveCount(0);
  await expect(page.locator('[data-testid="notification-list"] [data-unread="true"]')).toHaveCount(0, { timeout: 15_000 });
  expect(await rpc<number>(seller, "notification_unread_count")).toBe(0);
});

test("móvil (375 px): la campana abre un panel a pantalla completa, sin desplazamiento horizontal", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await ctx.newPage();
  await login(page, SELLER_EMAIL, /\/seller$/);
  await page.getByTestId("notification-bell").click();
  const panel = page.getByTestId("notifications-panel");
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  expect(box?.width).toBe(375);
  expect(box?.height).toBeGreaterThan(700);
  await expect(panel.getByRole("link", { name: "Ver todas" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Cerrar notificaciones" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
  await panel.getByRole("button", { name: "Cerrar notificaciones" }).click();
  await expect(panel).toHaveCount(0);
  await ctx.close();
});

test("admin: 'Nueva venta' llega en vivo cuando un vendedor envía una venta; abrirla lleva a su ficha", async ({ page }) => {
  await login(page, ADMIN_EMAIL, /\/admin$/);
  const before = await unreadOnBadge(page);
  const saleId = await pendingSale("Admin Vivo");

  const toastCard = page.getByRole("status").filter({ hasText: "Nueva venta" });
  await expect(toastCard).toBeVisible({ timeout: 20_000 });
  await expect(badge(page)).toHaveText(String(before + 1));

  await page.goto("/admin/notificaciones");
  const row = page.getByTestId("notification-list").getByTestId("notification-row").filter({ hasText: `E2E Admin Vivo ${stamp}` });
  await expect(row).toContainText("Nueva venta");
  await row.click();
  await page.waitForURL(new RegExp(`/admin/ventas/${saleId}$`), { timeout: 30_000 });
  await expect(badge(page)).toHaveCount(before === 0 ? 0 : 1);
});
