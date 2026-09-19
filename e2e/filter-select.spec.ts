import { execFileSync } from "node:child_process";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  EXAMPLE_PRICING,
  createTestProduct,
  deleteTestProducts,
} from "../supabase/scripts/fixtures/commission-test-products.mjs";
import { E2E_PASSWORD } from "./credentials";

/**
 * FILTROS DESPLEGABLES (`FilterSelect`, Radix) — sin `<select>` nativos en las
 * barras de filtros de Admin y Vendedor; menú oscuro propio; teclado; URL;
 * filtros combinados; capas (z-index/portal) y 375 px. Crea su propia venta
 * BORRADOR (Cuba) con un producto de prueba y la elimina al terminar.
 */
try {
  process.loadEnvFile(path.resolve(__dirname, "../.env.local"));
} catch {
  /* sin .env.local: las pruebas fallarán con un mensaje claro */
}

const ADMIN_EMAIL = "e2e-smile-admin@motods.test";
const SELLER_EMAIL = "e2e-smile-seller@motods.test";
const PASSWORD = E2E_PASSWORD;
const STAMP = Date.now().toString(36).toUpperCase();
const BUYER_LAST = `Filtros${STAMP}`;

test.describe.configure({ mode: "serial" });

const state = { saleId: "", productId: "" };
let svc: SupabaseClient;

test.beforeAll(async () => {
  const cwd = path.resolve(__dirname, "..");
  for (const [email, role, name] of [
    [ADMIN_EMAIL, "admin", "Admin Smile E2E"],
    [SELLER_EMAIL, "seller", "Vendedor Smile E2E"],
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
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const admin = createClient(url, anon, { auth: { persistSession: false } });
  await admin.auth.signInWithPassword({ email: ADMIN_EMAIL, password: PASSWORD });
  const seller = createClient(url, anon, { auth: { persistSession: false } });
  await seller.auth.signInWithPassword({ email: SELLER_EMAIL, password: PASSWORD });

  const product = await createTestProduct(admin, { name: `E2E FILTROS ${STAMP}`, pricing: EXAMPLE_PRICING });
  state.productId = product.productId;
  const { data: saleId } = await seller.rpc("create_sale_draft", { p_operation_type: "CUBA" });
  state.saleId = saleId as string;
  await seller.rpc("save_cuba_sale_draft", {
    p_sale_id: saleId,
    p_payload: {
      saleDate: new Date().toISOString().slice(0, 10), shareCommission: false, internalNotes: "Venta de prueba de filtros",
      buyer: {
        firstName: "E2E", lastName: BUYER_LAST, dateOfBirth: "1990-01-01", documentNumber: "E2E-FS-1",
        documentExpiration: "2031-01-01", phone: "(305) 555-0106", email: "", addressLine1: "1 Test St",
        addressLine2: "", city: "Miami", state: "FL", postalCode: "33101",
      },
      coBuyer: null,
      units: [{ productId: product.productId, variantId: product.variantId, agreedPriceCents: 450000 }],
      extras: [],
      cubaRecipient: {
        fullName: "Destinatario E2E", identityNumber: "90010112345", deliveryAddress: "Calle 1 #2",
        municipality: "Plaza", province: "La Habana", phonePrimary: "+53 55555555", phoneSecondary: "",
      },
      delivery: { method: "HOME_DELIVERY", reference: "" },
      paymentAllocations: [],
    },
  });
});

test.afterAll(async () => {
  if (!svc) return;
  if (state.saleId) await svc.from("sales").delete().eq("id", state.saleId);
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

/** Selects nativos VISIBLES (Radix deja uno oculto con aria-hidden para formularios). */
const nativeSelects = (page: Page) => page.locator("main select:not([aria-hidden='true'])");

async function choose(page: Page, trigger: Locator, option: string) {
  await trigger.click();
  await page.getByRole("option", { name: option, exact: true }).click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
}

const buyerRow = (page: Page) => page.getByText(new RegExp(BUYER_LAST)).first();

test("1 · Ningún <select> nativo en las barras de filtros de Admin y Vendedor", async ({ page }) => {
  await login(page, ADMIN_EMAIL);
  const adminPages = [
    "/admin/ventas", "/admin/productos", "/admin/comisiones", "/admin/logistica", "/admin/reportes",
    "/admin/alertas", "/admin/actividad", "/admin/financieras", "/admin/vendedores", "/admin/aprobaciones?tab=ediciones",
  ];
  for (const url of adminPages) {
    await page.goto(url);
    await expect(page.getByRole("combobox").first(), `${url}: filtro personalizado`).toBeVisible();
    expect(await nativeSelects(page).count(), `${url}: selects nativos visibles`).toBe(0);
  }
  await login(page, SELLER_EMAIL);
  await page.goto("/seller/ventas");
  await expect(page.getByRole("combobox", { name: "Filtrar por tipo de operación" })).toBeVisible();
  expect(await nativeSelects(page).count()).toBe(0);
});

test("2-7 · Operación: menú oscuro, opciones, selección, resultados, URL y filtros combinados", async ({ page }) => {
  await login(page, SELLER_EMAIL);
  await page.goto("/seller/ventas");
  const operation = page.getByRole("combobox", { name: "Filtrar por tipo de operación" });
  await expect(operation).toHaveText("Operación: Todas");
  await expect(buyerRow(page)).toBeVisible();

  // 2 · menú oscuro personalizado (no el menú nativo del sistema)
  await operation.click();
  const listbox = page.getByRole("listbox");
  await expect(listbox).toBeVisible();
  const bg = await listbox.evaluate((el) => getComputedStyle(el.closest("[data-radix-popper-content-wrapper] > *") ?? el).backgroundColor);
  const [r, g, b] = (bg.match(/\d+/g) ?? ["255", "255", "255"]).map(Number);
  expect(r + g + b, `fondo del menú ${bg}`).toBeLessThan(150);

  // 3 · las 4 opciones, con la actual marcada
  for (const label of ["Operación: Todas", "Operación: Cuba", "Operación: USA", "Operación: Local"]) {
    await expect(page.getByRole("option", { name: label, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("option", { name: "Operación: Todas", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");

  // 4-5 · selección visible + la tabla cambia igual que antes (param `operation`)
  await choose(page, operation, "Operación: USA");
  await expect(page).toHaveURL(/operation=usa/);
  await expect(operation).toHaveText("Operación: USA");
  await expect(page.getByText("No encontramos ventas con estos filtros.")).toBeVisible();
  await choose(page, operation, "Operación: Local");
  await expect(page).toHaveURL(/operation=local/);
  await choose(page, operation, "Operación: Cuba");
  await expect(page).toHaveURL(/operation=cuba/);
  await expect(buyerRow(page)).toBeVisible();

  // 6 · filtros combinados
  const status = page.getByRole("combobox", { name: "Filtrar por estado", exact: true });
  await choose(page, status, "Estado: Borrador");
  await expect(page).toHaveURL(/status=draft/);
  await expect(page).toHaveURL(/operation=cuba/);
  await expect(buyerRow(page)).toBeVisible();
  await choose(page, status, "Estado: Vendida");
  await expect(page).toHaveURL(/status=sold/);
  await expect(buyerRow(page)).toHaveCount(0);

  // 7 · la URL se conserva al recargar
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Filtrar por tipo de operación" })).toHaveText("Operación: Cuba");
  await expect(page.getByRole("combobox", { name: "Filtrar por estado", exact: true })).toHaveText("Estado: Vendida");

  // "Todas" neutraliza el filtro (el parámetro desaparece) y "Limpiar filtros" sigue funcionando
  await choose(page, page.getByRole("combobox", { name: "Filtrar por tipo de operación" }), "Operación: Todas");
  await expect(page).not.toHaveURL(/operation=/);
  await page.getByRole("button", { name: "Limpiar filtros" }).click();
  await expect(page).toHaveURL(/\/seller\/ventas$/);
  await expect(buyerRow(page)).toBeVisible();
});

test("8 · Teclado: Tab, Enter/flechas para abrir, flechas, Home/End, Enter y Escape", async ({ page }) => {
  await login(page, SELLER_EMAIL);
  await page.goto("/seller/ventas");
  const operation = page.getByRole("combobox", { name: "Filtrar por tipo de operación" });
  const status = page.getByRole("combobox", { name: "Filtrar por estado", exact: true });
  await status.focus();
  await page.keyboard.press("Tab"); // Tab lleva el foco al siguiente filtro
  await expect(operation).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(operation).toHaveText("Operación: Todas");
  await expect(operation).toBeFocused();

  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("End");
  await expect(page.getByRole("option", { name: "Operación: Local", exact: true })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(page.getByRole("option", { name: "Operación: Todas", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("option", { name: "Operación: Cuba", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(page).toHaveURL(/operation=cuba/);
  await expect(operation).toHaveText("Operación: Cuba");
});

test("9 · El menú queda por encima de tablas, tarjetas y cabeceras", async ({ page }) => {
  await login(page, ADMIN_EMAIL);
  await page.goto("/admin/ventas");
  await page.getByRole("combobox", { name: "Filtrar por vendedor" }).click();
  const options = page.getByRole("option");
  await expect(options.first()).toBeVisible();
  const count = await options.count();
  for (let i = 0; i < Math.min(count, 4); i++) {
    const topmost = await options.nth(i).evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return Boolean(hit && (hit === el || el.contains(hit)));
    });
    expect(topmost, `opción ${i} tapada por otro elemento`).toBe(true);
  }
});

test("10-11 · 375 px: táctil ≥ 44 px, menú dentro de la pantalla y sin desplazamiento horizontal", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await login(page, SELLER_EMAIL);
  await page.goto("/seller/ventas");
  const operation = page.getByRole("combobox", { name: "Filtrar por tipo de operación" });
  const box = await operation.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.x + box!.width).toBeLessThanOrEqual(375);
  await operation.click();
  const listbox = page.getByRole("listbox");
  await expect(listbox).toBeVisible();
  const lb = await listbox.boundingBox();
  expect(lb!.x).toBeGreaterThanOrEqual(0);
  expect(lb!.x + lb!.width).toBeLessThanOrEqual(375);
  expect(lb!.y + lb!.height).toBeLessThanOrEqual(740);
  const optionBox = await page.getByRole("option", { name: "Operación: Cuba", exact: true }).boundingBox();
  expect(optionBox!.height).toBeGreaterThanOrEqual(44);
  await page.getByRole("option", { name: "Operación: Cuba", exact: true }).click();
  await expect(page).toHaveURL(/operation=cuba/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("12 · Filtros con formulario (Admin → Alertas/Logística) y selector de variante siguen funcionando", async ({ page }) => {
  await login(page, ADMIN_EMAIL);
  await page.goto("/admin/alertas");
  const priority = page.getByRole("combobox", { name: "Prioridad" });
  await choose(page, priority, "Alta");
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(page).toHaveURL(/priority=HIGH/);
  await expect(page.getByRole("combobox", { name: "Prioridad" })).toHaveText("Alta");
  await page.getByRole("link", { name: "Limpiar" }).click();
  await expect(page).toHaveURL(/\/admin\/alertas$/);
  await expect(page.getByRole("combobox", { name: "Prioridad" })).not.toHaveText("Alta");

  await page.goto("/admin/logistica");
  await choose(page, page.getByRole("combobox", { name: "Vendedor" }), "Vendedor Smile E2E");
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(page).toHaveURL(/seller=[0-9a-f-]{36}/);
  await choose(page, page.getByRole("combobox", { name: "Vendedor" }), "Todos");
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(page).toHaveURL(/seller=(&|$)/);

  // Formulario de venta: el selector de variante (campo controlado) sigue guardando la variante.
  await login(page, SELLER_EMAIL);
  await page.goto(`/seller/ventas/${state.saleId}`);
  const units = page.locator("#section-units");
  const variant = units.getByRole("combobox", { name: /Color \/ acabado/ });
  await expect(variant).toHaveText("Negro E2E");
  await choose(page, variant, "Selecciona una variante");
  await expect(variant).toHaveText("Selecciona una variante");
  await choose(page, variant, "Negro E2E");
  await expect(variant).toHaveText("Negro E2E");
});
