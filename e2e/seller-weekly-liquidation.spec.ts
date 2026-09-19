import { execFileSync } from "node:child_process";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import {
  EXAMPLE_PRICING,
  createTestProduct,
  deleteTestProducts,
} from "../supabase/scripts/fixtures/commission-test-products.mjs";
import { E2E_PASSWORD } from "./credentials";

/**
 * Panel del vendedor + "Mis liquidaciones" semanal (interfaz), con la regla
 * "la comisión se liquida al quedar la venta VENDIDA": ventas confirmadas que
 * suman sin esperar a PAGADA; "Próximas a confirmar" (PENDIENTES, comisión
 * ESTIMADA no incluida) y las de semanas anteriores; paso de PENDIENTE a
 * VENDIDA; navegación semanal; venta ajena por URL bloqueada; admin con acceso
 * completo; 375 px sin desplazamiento horizontal. Crea y borra sus datos.
 */
try {
  process.loadEnvFile(path.resolve(__dirname, "../.env.local"));
} catch {
  /* sin .env.local: las pruebas fallarán con un mensaje claro */
}

const ADMIN_EMAIL = "e2e-smile-admin@motods.test";
const SELLER_EMAIL = "e2e-smile-seller@motods.test";
const SELLER2_EMAIL = "e2e-smile-seller2@motods.test";
const PASSWORD = E2E_PASSWORD;
const ZELLE = "2ab4abc7-f6a4-41a9-84b0-e0d2d0668fce";
const STAMP = Date.now().toString(36).toUpperCase();

test.describe.configure({ mode: "serial" });

const state = {
  productId: "",
  sales: [] as string[],
  draft: "",
  pending: "",
  old: "",
  sold: "",
  foreign: "",
  weekStart: "",
};
let svc: SupabaseClient;
let sellerApi: Api;

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

type Api = { c: SupabaseClient; id: string };
async function client(email: string): Promise<Api> {
  const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });
  const { data, error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return { c, id: data.user!.id };
}

async function makeSale(by: Api, product: { productId: string; variantId: string }, opts: { buyer: string; saleDate: string; price: number; submit: boolean }) {
  const { data: saleId } = await by.c.rpc("create_sale_draft", { p_operation_type: "CUBA" });
  state.sales.push(saleId as string);
  await by.c.rpc("save_cuba_sale_draft", {
    p_sale_id: saleId,
    p_payload: {
      saleDate: opts.saleDate, shareCommission: false, internalNotes: "Venta de prueba semanal",
      buyer: {
        firstName: "E2E", lastName: `${opts.buyer} ${STAMP}`, dateOfBirth: "1990-01-01", documentNumber: "E2E-WK-UI",
        documentExpiration: "2031-01-01", phone: "(305) 555-0108", email: "", addressLine1: "1 Test St",
        addressLine2: "", city: "Miami", state: "FL", postalCode: "33101",
      },
      coBuyer: null,
      units: [{ productId: product.productId, variantId: product.variantId, agreedPriceCents: opts.price }],
      extras: [],
      cubaRecipient: {
        fullName: "Destinatario E2E", identityNumber: "90010112345", deliveryAddress: "Calle 1 #2",
        municipality: "Plaza", province: "La Habana", phonePrimary: "+53 55555555", phoneSecondary: "",
      },
      delivery: { method: "HOME_DELIVERY", reference: "" },
      paymentAllocations: [{ id: null, paymentMethodId: ZELLE, planId: null, inputMode: "NET", amountCents: opts.price, reference: "E2E", notes: "" }],
    },
  });
  for (const [subject, side] of [["BUYER", "FRONT"], ["BUYER", "BACK"], ["CUBA_RECIPIENT", "FRONT"], ["CUBA_RECIPIENT", "BACK"]]) {
    await by.c.rpc("record_sale_document", {
      p_sale_id: saleId, p_subject_type: subject, p_side: side,
      p_storage_path: `${by.id}/${saleId}/${subject.toLowerCase()}-${side.toLowerCase()}.jpg`, p_mime_type: "image/jpeg", p_file_size_bytes: 1000,
    });
  }
  if (opts.submit) {
    const { data } = await by.c.rpc("request_sale_review", { p_sale_id: saleId });
    if (!(data as { ok?: boolean })?.ok) throw new Error(`review: ${JSON.stringify(data)}`);
  }
  return saleId as string;
}

test.beforeAll(async () => {
  const cwd = path.resolve(__dirname, "..");
  for (const [email, role, name] of [
    [ADMIN_EMAIL, "admin", "Admin Smile E2E"],
    [SELLER_EMAIL, "seller", "Vendedor Smile E2E"],
    [SELLER2_EMAIL, "seller", "Vendedor Smile E2E 2"],
  ] as const) {
    execFileSync(
      "node",
      ["--env-file=.env.local", "supabase/scripts/create-user.mjs", "--email", email, "--password", PASSWORD, "--role", role, "--name", name],
      { cwd, stdio: "ignore" },
    );
  }
  svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const admin = await client(ADMIN_EMAIL);
  const seller = await client(SELLER_EMAIL);
  const seller2 = await client(SELLER2_EMAIL);
  const product = await createTestProduct(admin.c, { name: `E2E SEMANAL UI ${STAMP}`, pricing: EXAMPLE_PRICING });
  state.productId = product.productId;

  sellerApi = seller;
  const { data: week } = await seller.c.rpc("seller_weekly_liquidation", {});
  state.weekStart = (week as { currentWeekStart: string }).currentWeekStart;
  const W = state.weekStart;
  state.draft = await makeSale(seller, product, { buyer: "Borrador", saleDate: W, price: 470000, submit: false });
  state.pending = await makeSale(seller, product, { buyer: "Pendiente", saleDate: W, price: 470000, submit: true });
  state.old = await makeSale(seller, product, { buyer: "Antigua", saleDate: addDays(W, -14), price: 450000, submit: true });
  // VENDIDA hoy y SIN cobrar al cliente: ya suma a la liquidación.
  state.sold = await makeSale(seller, product, { buyer: "Vendida", saleDate: W, price: 500000, submit: true });
  const { data: sold } = await seller.c.rpc("mark_sale_sold", { p_sale_id: state.sold });
  if (!(sold as { ok?: boolean })?.ok) throw new Error(`vendida: ${JSON.stringify(sold)}`);
  state.foreign = await makeSale(seller2, product, { buyer: "Ajena", saleDate: W, price: 450000, submit: false });
});

test.afterAll(async () => {
  if (!svc) return;
  for (const id of state.sales) await svc.from("sales").delete().eq("id", id);
  if (state.productId) await deleteTestProducts(svc, [state.productId]);
});

async function login(page: Page, email: string) {
  await page.request.post("/auth/signout");
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: /iniciar sesión/i }).click();
  await page.waitForURL(email === ADMIN_EMAIL ? /\/admin$/ : /\/seller$/, { timeout: 30_000 });
}

test("1 · Mis ventas: BORRADOR y PENDIENTE visibles con comisión ESTIMADA; VENDIDA con la confirmada", async ({ page }) => {
  await login(page, SELLER_EMAIL);
  await page.goto(`/seller/ventas?q=${STAMP}`);
  await expect(page.getByRole("columnheader", { name: "Comisión" })).toBeVisible();
  const draftRow = page.getByRole("row").filter({ hasText: `Borrador ${STAMP}` });
  await expect(draftRow).toContainText("$600.00");
  await expect(draftRow).toContainText(/Estimada · borrador — no liquidable/i);
  const pendingRow = page.getByRole("row").filter({ hasText: `Pendiente ${STAMP}` });
  await expect(pendingRow).toContainText("Pendiente");
  await expect(pendingRow).toContainText(/Estimada — no incluida en la liquidación/i);
  const soldRow = page.getByRole("row").filter({ hasText: `Vendida ${STAMP}` });
  await expect(soldRow).toContainText("$750.00");
  await expect(soldRow).toContainText(/Confirmada/i);
  await expect(pendingRow.getByRole("link", { name: /Abrir la venta/ })).toHaveAttribute("href", `/seller/ventas/${state.pending}`);
});

test("2-10 · Mis liquidaciones: confirmadas suman (sin esperar a PAGADA); próximas a confirmar aparte", async ({ page }) => {
  await login(page, SELLER_EMAIL);
  await page.goto("/seller/liquidaciones");
  await expect(page.getByRole("heading", { level: 1, name: "Semana actual" })).toBeVisible();
  await expect(page.getByText("Vendedor Smile E2E", { exact: true }).first()).toBeVisible();

  const summary = page.getByRole("region", { name: "Resumen de la semana" });
  const metric = (label: string) => summary.locator("div").filter({ has: page.getByText(label, { exact: true }) }).first();
  await expect(metric("Comisiones")).toContainText("$750.00");
  await expect(metric("Unidades vendidas")).toContainText("1");
  await expect(metric("Total a liquidar")).toContainText("$750.00");
  await expect(summary.getByText("Bono de marketing", { exact: true })).toBeVisible();
  await expect(summary.getByText("Bono de ventas", { exact: true })).toBeVisible();
  const upcomingBox = summary.getByRole("group", { name: "Próximas a confirmar" });
  await expect(upcomingBox).toContainText("Próximas a confirmar: 2 ventas");
  await expect(upcomingBox).toContainText("$1,100.00");

  // Confirmadas: la VENDIDA (sin cobrar) suma ya.
  const soldRow = page.locator(`table[aria-label="Ventas confirmadas"] tr[data-sale-id="${state.sold}"]`);
  await expect(soldRow).toContainText("Vendida");
  await expect(soldRow).toContainText("$750.00");
  await expect(soldRow).toContainText("Incluida en esta liquidación");

  // Próximas a confirmar: la PENDIENTE de esta semana, estimada y fuera del total.
  const pendingRow = page.locator(`table[aria-label="Próximas a confirmar"] tr[data-sale-id="${state.pending}"]`);
  await expect(pendingRow).toContainText("Pendiente");
  await expect(pendingRow).toContainText("$600.00");
  await expect(pendingRow).toContainText(/Estimada — no incluida en la liquidación/i);
  await expect(page.locator(`tr[data-sale-id="${state.draft}"]`)).toHaveCount(0);

  // Pendiente antigua: sección destacada.
  await expect(page.getByRole("heading", { name: /Próximas a confirmar de semanas anteriores — 1 venta/i })).toBeVisible();
  const oldRow = page.locator(`table[aria-label="Próximas a confirmar de semanas anteriores"] tr[data-sale-id="${state.old}"]`);
  await expect(oldRow).toContainText(/Estimada — no incluida en la liquidación/i);
  await expect(oldRow.getByRole("link", { name: /Abrir la venta/ })).toBeVisible();

  // Al pasar a VENDIDA: sale de las pendientes y su comisión congelada suma.
  const { data: sold } = await sellerApi.c.rpc("mark_sale_sold", { p_sale_id: state.pending });
  expect((sold as { ok?: boolean }).ok).toBe(true);
  await page.reload();
  await expect(page.locator(`table[aria-label="Próximas a confirmar"] tr[data-sale-id="${state.pending}"]`)).toHaveCount(0);
  await expect(page.locator(`table[aria-label="Ventas confirmadas"] tr[data-sale-id="${state.pending}"]`)).toContainText("Incluida en esta liquidación");
  await expect(metric("Total a liquidar")).toContainText("$1,350.00");
  await expect(metric("Unidades vendidas")).toContainText("2");
  await expect(summary.getByRole("group", { name: "Próximas a confirmar" })).toContainText("Próximas a confirmar: 1 venta");

  // Navegación semanal: la semana anterior no tiene estas comisiones.
  await page.getByRole("link", { name: "Semana anterior" }).click();
  await expect(page).toHaveURL(new RegExp(`week=${addDays(state.weekStart, -7)}`));
  await expect(page.getByRole("heading", { level: 1, name: "Semana seleccionada" })).toBeVisible();
  await expect(metric("Total a liquidar")).toContainText("$0.00");
  await page.getByRole("link", { name: "Ir a la semana actual" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Semana actual" })).toBeVisible();
});

test("13-14 · URL de una venta ajena bloqueada para el vendedor; el admin la ve", async ({ page }) => {
  await login(page, SELLER_EMAIL);
  // RLS no devuelve la venta → `notFound()`. La ruta tiene `loading.tsx`
  // (streaming), así que el código HTTP ya salió como 200: se verifica el
  // contenido — página 404 y ningún dato de la venta ajena.
  await page.goto(`/seller/ventas/${state.foreign}`);
  await expect(page.getByText(/This page could not be found|404/).first()).toBeVisible();
  await expect(page.getByText(`Ajena ${STAMP}`)).toHaveCount(0);
  await expect(page.getByText("Venta de prueba semanal")).toHaveCount(0);

  await login(page, ADMIN_EMAIL);
  const adminRes = await page.goto(`/admin/ventas/${state.foreign}`);
  expect(adminRes?.status()).toBe(200);
  await expect(page.getByText(`Ajena ${STAMP}`).first()).toBeVisible();
  await page.goto(`/admin/ventas/${state.pending}`);
  await expect(page.getByText(`Pendiente ${STAMP}`).first()).toBeVisible();
});

test("15 · 375 px: tarjetas legibles, botón de ojo táctil y sin desplazamiento horizontal", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await login(page, SELLER_EMAIL);
  for (const url of ["/seller/liquidaciones", `/seller/ventas?q=${STAMP}`]) {
    await page.goto(url);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${url}: desplazamiento horizontal`).toBeLessThanOrEqual(0);
  }
  await page.goto("/seller/liquidaciones");
  const card = page.locator(`ul[aria-label="Próximas a confirmar de semanas anteriores"] li[data-sale-id="${state.old}"]`);
  await expect(card).toBeVisible();
  await expect(card).toContainText(`Antigua ${STAMP}`);
  await expect(card).toContainText("$4,500.00");
  await expect(card).toContainText(/Estimada — no incluida en la liquidación/i);
  const soldCard = page.locator(`ul[aria-label="Ventas confirmadas"] li[data-sale-id="${state.sold}"]`);
  await expect(soldCard).toContainText("$750.00");
  const eye = card.getByRole("link", { name: /Abrir la venta/ });
  const box = await eye.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(44);
  await expect(page.locator("table").first()).toBeHidden();
});
