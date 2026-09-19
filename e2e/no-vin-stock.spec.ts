import { execFileSync } from "node:child_process";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { commissionTier } from "../supabase/scripts/fixtures/commission-test-products.mjs";

/**
 * Sin VIN ni stock físico (migración 20260918120000) — verificación de
 * interfaz: Productos, ficha de venta Admin y Vendedor, navegación, alertas,
 * reportes, actividad y búsqueda global. Crea su propia venta VENDIDA (con
 * seguimiento, logística y comisión) y la elimina al terminar. La comisión del
 * producto de prueba usa SOLO valores temporales de la fixture (nivel N3:
 * referencia $3,999 · base $400).
 */
try {
  process.loadEnvFile(path.resolve(__dirname, "../.env.local"));
} catch {
  /* sin .env.local: las pruebas fallarán con un mensaje claro */
}

const ADMIN_EMAIL = "e2e-smile-admin@motods.test";
const SELLER_EMAIL = "e2e-smile-seller@motods.test";
const PASSWORD = "Smile-E2E-Pw-1!";
const ZELLE = "2ab4abc7-f6a4-41a9-84b0-e0d2d0668fce";
const T3 = commissionTier(3);

test.describe.configure({ mode: "serial" });

const fixture: { saleId: string; productId: string; tracking: string } = { saleId: "", productId: "", tracking: "" };
let svc: SupabaseClient;

async function client(email: string) {
  const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });
  const { data, error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return { c, id: data.user!.id };
}

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
  const admin = await client(ADMIN_EMAIL);
  const seller = await client(SELLER_EMAIL);

  const { data: p } = await admin.c.rpc("admin_create_product", {
    p_name: `E2E UI NOVIN ${Date.now().toString(36).toUpperCase()}`, p_brand: "E2E", p_category: "Moto",
    p_base_price_cents: T3.fixedPriceCents, p_cuba_total_cents: T3.fixedPriceCents, p_is_active: true,
  });
  fixture.productId = (p as { productId: string }).productId;
  const { data: v } = await admin.c.rpc("admin_create_product_variant", { p_product_id: fixture.productId, p_color_name: "Negro E2E" });
  await admin.c.rpc("admin_update_product_commission_defaults", {
    p_product_id: fixture.productId, p_default_reference_price_cents: T3.fixedPriceCents, p_default_base_commission_cents: T3.fixedCommissionCents,
  });

  const { data: saleId } = await seller.c.rpc("create_sale_draft", { p_operation_type: "CUBA" });
  fixture.saleId = saleId as string;
  await seller.c.rpc("save_cuba_sale_draft", {
    p_sale_id: fixture.saleId,
    p_payload: {
      saleDate: new Date().toISOString().slice(0, 10), shareCommission: false, internalNotes: "Venta de prueba de interfaz",
      buyer: {
        firstName: "E2E", lastName: "Interfaz", dateOfBirth: "1990-01-01", documentNumber: "E2E-UI-1",
        documentExpiration: "2031-01-01", phone: "(305) 555-0103", email: "", addressLine1: "1 Test St",
        addressLine2: "", city: "Miami", state: "FL", postalCode: "33101",
      },
      coBuyer: null,
      units: [{ productId: fixture.productId, variantId: (v as { variantId: string }).variantId, agreedPriceCents: 439900 }],
      extras: [],
      cubaRecipient: {
        fullName: "Destinatario E2E", identityNumber: "90010112345", deliveryAddress: "Calle 1 #2",
        municipality: "Plaza", province: "La Habana", phonePrimary: "+53 55555555", phoneSecondary: "",
      },
      delivery: { method: "HOME_DELIVERY", reference: "" },
      paymentAllocations: [{ id: null, paymentMethodId: ZELLE, planId: null, inputMode: "NET", amountCents: 439900, reference: "E2E", notes: "" }],
    },
  });
  for (const [subject, side] of [["BUYER", "FRONT"], ["BUYER", "BACK"], ["CUBA_RECIPIENT", "FRONT"], ["CUBA_RECIPIENT", "BACK"]]) {
    await seller.c.rpc("record_sale_document", {
      p_sale_id: fixture.saleId, p_subject_type: subject, p_side: side,
      p_storage_path: `${seller.id}/${fixture.saleId}/${subject.toLowerCase()}-${side.toLowerCase()}.jpg`,
      p_mime_type: "image/jpeg", p_file_size_bytes: 1000,
    });
  }
  await seller.c.rpc("request_sale_review", { p_sale_id: fixture.saleId });
  const { data: sold } = await seller.c.rpc("mark_sale_sold", { p_sale_id: fixture.saleId });
  if (!(sold as { ok?: boolean })?.ok) throw new Error(`fixture no pasó a VENDIDA: ${JSON.stringify(sold)}`);
  const { data: units } = await svc.from("sale_units").select("tracking_code").eq("sale_id", fixture.saleId);
  fixture.tracking = units?.[0]?.tracking_code ?? "";
});

test.afterAll(async () => {
  if (fixture.saleId) await svc.from("sales").delete().eq("id", fixture.saleId);
  if (fixture.productId) {
    await svc.from("product_catalog_events").delete().eq("product_id", fixture.productId);
    await svc.from("product_variants").delete().eq("product_id", fixture.productId);
    await svc.from("products").delete().eq("id", fixture.productId);
  }
});

async function login(page: Page, email: string) {
  await page.request.post("/auth/signout");
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: /iniciar sesión/i }).click();
  await page.waitForURL(email === ADMIN_EMAIL ? /\/admin$/ : /\/seller$/, { timeout: 30_000 });
}

/** Ningún texto visible de VIN / stock físico en la página. */
async function expectNoVinOrStock(page: Page) {
  const body = await page.locator("main").innerText();
  expect(body).not.toMatch(/\bVIN\b/);
  expect(body).not.toMatch(/Cantidad reportada|Resumen de (inventario|stock)|Stock disponible|Asignar VIN|Liberar VIN|Reservad[ao]s?\b|Disponibles\b/);
}

test("7 · Ficha de producto: sin cantidades ni VIN; comisión del producto presente", async ({ page }) => {
  await login(page, ADMIN_EMAIL);
  await page.goto(`/admin/productos/${fixture.productId}`);
  await expect(page.getByRole("heading", { name: /E2E UI NOVIN/ })).toBeVisible();
  await expect(page.getByLabel("Precio fijo de venta (USD)")).toHaveValue("3999.00");
  await expect(page.getByLabel("Comisión fija (USD)")).toHaveValue("400.00");
  await expect(page.getByText("Variantes", { exact: true })).toBeVisible();
  await expectNoVinOrStock(page);

  await page.goto("/admin/productos");
  await expect(page.getByRole("columnheader", { name: "Precio fijo y comisión" })).toBeVisible();
  await expect(page.getByText("Resumen de stock")).toHaveCount(0);
});

test("8 · Ficha de venta Admin: sin VIN/inventario; seguimiento, logística y comisión visibles", async ({ page }) => {
  await login(page, ADMIN_EMAIL);
  await page.goto(`/admin/ventas/${fixture.saleId}`);
  await expect(page.getByRole("heading", { name: "Unidades y seguimiento" })).toBeVisible();
  await expect(page.getByText(fixture.tracking).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Logística / envío" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Comisión de vendedor" })).toBeVisible();
  await expect(page.getByText("Inventario", { exact: true })).toHaveCount(0);
  await expectNoVinOrStock(page);
});

test("9 · Ficha de venta Vendedor: sin VIN; seguimiento, logística y comisión visibles", async ({ page }) => {
  await login(page, SELLER_EMAIL);
  await page.goto(`/seller/ventas/${fixture.saleId}`);
  await expect(page.getByText(fixture.tracking).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /Unidades y seguimiento/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Logística \/ Envío/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Tu comisión/ })).toBeVisible();
  await expectNoVinOrStock(page);
});

test("10 · VIN/stock ausente de navegación, alertas, reportes, actividad y búsqueda", async ({ page }) => {
  await login(page, ADMIN_EMAIL);
  const nav = page.getByRole("navigation", { name: "Navegación de administración" });
  await expect(nav.getByRole("link", { name: "Inventario" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Productos" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Logística" })).toBeVisible();

  await page.goto("/admin/inventario");
  await expect(page).toHaveURL(/\/admin\/productos$/);

  await page.goto("/admin/alertas");
  await expect(page.getByText("Inventario", { exact: true })).toHaveCount(0);
  await expectNoVinOrStock(page);

  await page.goto("/admin/reportes?tab=productos");
  await expect(page.getByText("Stock disponible")).toHaveCount(0);

  await page.goto("/admin/actividad");
  await expect(page.locator("option", { hasText: "Inventario" })).toHaveCount(0);

  await page.goto("/admin");
  await page.waitForLoadState("networkidle");
  await page.keyboard.press("Control+k");
  const box = page.getByRole("combobox", { name: "Buscar" });
  await box.fill(fixture.tracking);
  await expect(page.getByRole("option", { name: new RegExp("E2E Interfaz") })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Inventario (VIN)")).toHaveCount(0);
  await box.fill("Agregar VIN");
  await expect(page.getByRole("option", { name: /Agregar VIN/ })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await login(page, SELLER_EMAIL);
  const sellerNav = page.getByRole("navigation", { name: "Navegación del vendedor" }).first();
  await expect(sellerNav.getByRole("link", { name: "Stock" })).toHaveCount(0);
  await page.goto("/seller/inventario");
  await expect(page).toHaveURL(/\/seller$/);
});
