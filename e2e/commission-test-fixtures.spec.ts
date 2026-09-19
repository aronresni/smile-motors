import { execFileSync } from "node:child_process";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  COMMISSION_TEST_PRODUCTS,
  EXAMPLE_PRICING,
  createCommissionTestProducts,
  createTestProduct,
  deleteTestProducts,
  leftoverTestProducts,
  snapshotRealProducts,
} from "../supabase/scripts/fixtures/commission-test-products.mjs";
import { E2E_PASSWORD } from "./credentials";

/**
 * PRECIO FIJO DE VENTA + COMISIÓN FIJA — interfaz, con VALORES DE PRUEBA
 * TEMPORALES (fixture): el panel muestra y valida ambos valores; el simulador
 * de la ficha y las fichas de venta muestran el desglose; el formulario de
 * venta completa el precio fijo, no deja bajar de él y estima la comisión en
 * vivo; una venta con un producto sin configurar queda bloqueada hasta que el
 * admin lo configura desde la ficha; el vendedor no accede a la ficha de
 * producto. Al terminar no queda ningún valor de prueba; los productos reales
 * no se tocan.
 */
try {
  process.loadEnvFile(path.resolve(__dirname, "../.env.local"));
} catch {
  /* sin .env.local: las pruebas fallarán con un mensaje claro */
}

const ADMIN_EMAIL = "e2e-smile-admin@motods.test";
const SELLER_EMAIL = "e2e-smile-seller@motods.test";
const PASSWORD = E2E_PASSWORD;
const ZELLE = "2ab4abc7-f6a4-41a9-84b0-e0d2d0668fce";

const PREFIX = `E2E COMISION UI ${Date.now().toString(36).toUpperCase()}`;
const EXAMPLE_NAME = `${PREFIX} EJEMPLO`;
const FRESH_NAME = `${PREFIX} SIN CONFIG`;
const FRESH2_NAME = `${PREFIX} SIN CONFIG 2`;

test.describe.configure({ mode: "serial" });

const state = {
  productIds: [] as string[],
  saleIds: [] as string[],
  exampleId: "",
  freshId: "",
  soldSaleId: "",
  pendingSaleId: "",
  blockedSaleId: "",
  baseline: [] as Awaited<ReturnType<typeof snapshotRealProducts>>,
};
let svc: SupabaseClient;

const usd = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

async function client(email: string) {
  const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });
  const { data, error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return { c, id: data.user!.id };
}

type Api = Awaited<ReturnType<typeof client>>;

async function pendingSale(seller: Api, productId: string, variantId: string, priceCents: number) {
  const { data: saleId } = await seller.c.rpc("create_sale_draft", { p_operation_type: "CUBA" });
  state.saleIds.push(saleId as string);
  await seller.c.rpc("save_cuba_sale_draft", {
    p_sale_id: saleId,
    p_payload: {
      saleDate: new Date().toISOString().slice(0, 10), shareCommission: false, internalNotes: "Venta de prueba de comisiones",
      buyer: {
        firstName: "E2E", lastName: "Comisiones UI", dateOfBirth: "1990-01-01", documentNumber: "E2E-CM-UI",
        documentExpiration: "2031-01-01", phone: "(305) 555-0105", email: "", addressLine1: "1 Test St",
        addressLine2: "", city: "Miami", state: "FL", postalCode: "33101",
      },
      coBuyer: null,
      units: [{ productId, variantId, agreedPriceCents: priceCents }],
      extras: [],
      cubaRecipient: {
        fullName: "Destinatario E2E", identityNumber: "90010112345", deliveryAddress: "Calle 1 #2",
        municipality: "Plaza", province: "La Habana", phonePrimary: "+53 55555555", phoneSecondary: "",
      },
      delivery: { method: "HOME_DELIVERY", reference: "" },
      paymentAllocations: [{ id: null, paymentMethodId: ZELLE, planId: null, inputMode: "NET", amountCents: priceCents, reference: "E2E", notes: "" }],
    },
  });
  for (const [subject, side] of [["BUYER", "FRONT"], ["BUYER", "BACK"], ["CUBA_RECIPIENT", "FRONT"], ["CUBA_RECIPIENT", "BACK"]]) {
    await seller.c.rpc("record_sale_document", {
      p_sale_id: saleId, p_subject_type: subject, p_side: side,
      p_storage_path: `${seller.id}/${saleId}/${subject.toLowerCase()}-${side.toLowerCase()}.jpg`,
      p_mime_type: "image/jpeg", p_file_size_bytes: 1000,
    });
  }
  const { data: review } = await seller.c.rpc("request_sale_review", { p_sale_id: saleId });
  if (!(review as { ok?: boolean })?.ok) throw new Error(`la venta de prueba no pasó a PENDIENTE: ${JSON.stringify(review)}`);
  return saleId as string;
}

async function cleanup() {
  for (const id of state.saleIds) await svc.from("sales").delete().eq("id", id);
  const errors = await deleteTestProducts(svc, state.productIds);
  if (errors.length) throw new Error(errors.join("; "));
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
  state.baseline = await snapshotRealProducts(svc);
  const admin = await client(ADMIN_EMAIL);
  const seller = await client(SELLER_EMAIL);

  // Productos de prueba: ejemplo $4,500/$500, los 8 niveles y 2 sin configurar.
  const example = await createTestProduct(admin.c, { name: EXAMPLE_NAME, pricing: EXAMPLE_PRICING });
  const tiers = await createCommissionTestProducts(admin.c, PREFIX);
  const fresh = await createTestProduct(admin.c, { name: FRESH_NAME });
  const fresh2 = await createTestProduct(admin.c, { name: FRESH2_NAME });
  state.productIds.push(example.productId, ...tiers.map((p) => p.productId), fresh.productId, fresh2.productId);
  state.exampleId = example.productId;
  state.freshId = fresh.productId;

  // Ventas: VENDIDA a $4,700 (desglose congelado), PENDIENTE a $5,000
  // (estimada) y PENDIENTE a $4,700 con el producto sin configurar (bloqueada).
  state.soldSaleId = await pendingSale(seller, example.productId, example.variantId, 470000);
  const { data: sold } = await seller.c.rpc("mark_sale_sold", { p_sale_id: state.soldSaleId });
  if (!(sold as { ok?: boolean })?.ok) throw new Error(`la venta de prueba no pasó a VENDIDA: ${JSON.stringify(sold)}`);
  state.pendingSaleId = await pendingSale(seller, example.productId, example.variantId, 500000);
  // El producto sin configurar no deja enviar a revisión: se prepara con la
  // configuración de ejemplo y luego se le quita (dato de prueba propio).
  await admin.c.rpc("admin_update_product_commission_defaults", {
    p_product_id: fresh.productId, p_default_reference_price_cents: 450000, p_default_base_commission_cents: 50000,
  });
  state.blockedSaleId = await pendingSale(seller, fresh.productId, fresh.variantId, 470000);
  await svc.from("products").update({ default_reference_price_cents: null, default_base_commission_cents: null })
    .eq("id", fresh.productId).ilike("name", "E2E %");
});

test.afterAll(async () => {
  // Red de seguridad (idempotente) si alguna prueba falló antes de la limpieza.
  if (svc) await cleanup();
});

async function login(page: Page, email: string) {
  await page.request.post("/auth/signout");
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: /iniciar sesión/i }).click();
  await page.waitForURL(email === ADMIN_EMAIL ? /\/admin$/ : /\/seller$/, { timeout: 30_000 });
}

/** Comprueba cada fila (término → importe) de un desglose de comisión. */
async function expectBreakdown(dl: Locator, rows: [string, number][]) {
  for (const [term, cents] of rows) {
    await expect(dl.locator("div").filter({ has: dl.page().getByText(term, { exact: true }) })).toContainText(usd(cents));
  }
}

const productValues = async (id: string) =>
  (await svc.from("products").select("default_reference_price_cents, default_base_commission_cents").eq("id", id).single()).data;
const saleStatus = async (id: string) => (await svc.from("sales").select("status").eq("id", id).single()).data?.status;

test("11 · Panel: precio fijo y comisión de los productos de prueba + simulador con desglose", async ({ page }) => {
  await login(page, ADMIN_EMAIL);
  await page.goto(`/admin/productos?q=${encodeURIComponent(PREFIX)}`);
  for (const t of [...COMMISSION_TEST_PRODUCTS, EXAMPLE_PRICING]) {
    expect(t.fixedPriceCents).toBeGreaterThanOrEqual(350000);
    expect(t.fixedPriceCents).toBeLessThanOrEqual(599900);
    const name = t === EXAMPLE_PRICING ? EXAMPLE_NAME : `${PREFIX} N${t.tier}`;
    const row = page.getByRole("row").filter({ hasText: name }).first();
    await expect(row).toContainText(`Precio fijo ${usd(t.fixedPriceCents)}`);
    await expect(row).toContainText(`comisión ${usd(t.fixedCommissionCents)}`);
  }
  await expect(page.getByRole("row").filter({ hasText: FRESH2_NAME })).toContainText("Sin configurar");

  await page.goto(`/admin/productos/${state.exampleId}`);
  await expect(page.getByLabel("Precio fijo de venta (USD)")).toHaveValue("4500.00");
  await expect(page.getByLabel("Comisión fija (USD)")).toHaveValue("500.00");
  await page.getByLabel("Simular precio de venta (USD)").fill("4700");
  await expectBreakdown(page.locator('dl[aria-label="Simulación de comisión"]'), [
    ["Precio fijo", 450000],
    ["Comisión fija", 50000],
    ["Precio de venta", 470000],
    ["Adicional generado", 20000],
    ["Para el vendedor", 10000],
    ["Para la tienda", 10000],
    ["Comisión total", 60000],
  ]);
  await page.getByLabel("Simular precio de venta (USD)").fill("4400");
  await expect(page.getByText("No se permite vender por debajo del precio fijo ($4,500.00).")).toBeVisible();
});

test("12 · Admin: valida y guarda desde la ficha; la venta bloqueada pasa a VENDIDA con el desglose congelado", async ({ page }) => {
  const alertText = `Producto activo sin precio fijo de venta o comisión fija · ${FRESH_NAME}`;
  await login(page, ADMIN_EMAIL);

  await page.goto("/admin/alertas?category=COMISIONES");
  await expect(page.getByText(alertText, { exact: true }).first()).toBeVisible();

  // Sin configurar: la venta NO pasa a VENDIDA.
  await page.goto(`/admin/ventas/${state.blockedSaleId}`);
  await page.getByRole("button", { name: "Marcar como vendida" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Marcar como vendida" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Falta el precio fijo de venta o la comisión fija");
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  expect(await saleStatus(state.blockedSaleId)).toBe("PENDING");

  // Ficha del producto: errores claros para vacío, cero, inválido y comisión >= precio.
  await page.goto(`/admin/productos/${state.freshId}`);
  const price = page.getByLabel("Precio fijo de venta (USD)");
  const commission = page.getByLabel("Comisión fija (USD)");
  const save = page.getByRole("button", { name: "Guardar precio fijo y comisión" });
  await expect(page.getByText(/Sin configurar: una venta de este producto/)).toBeVisible();
  await expect(price).toHaveValue("");
  await save.click();
  await expect(page.getByText("Completa el precio fijo de venta.")).toBeVisible();
  await expect(page.getByText("Completa la comisión fija.")).toBeVisible();
  await price.fill("0");
  await commission.fill("0");
  await expect(page.getByText("El precio fijo de venta debe ser mayor que $0.")).toBeVisible();
  await expect(page.getByText("La comisión fija debe ser mayor que $0.")).toBeVisible();
  await price.fill("4.500.00");
  await expect(page.getByText("Escribe un importe válido (por ejemplo 4500 o 4,500.00).")).toBeVisible();
  await price.fill("4500");
  await commission.fill("4500");
  await expect(page.getByText("La comisión fija debe ser menor que el precio fijo de venta.")).toBeVisible();
  await save.click();
  expect(await productValues(state.freshId)).toEqual({ default_reference_price_cents: null, default_base_commission_cents: null });

  // Valores válidos desde el panel (sin código ni comandos).
  await commission.fill("500");
  await save.click();
  await expect(page.getByText("Precio fijo y comisión guardados.")).toBeVisible();
  await expect
    .poll(() => productValues(state.freshId))
    .toEqual({ default_reference_price_cents: 450000, default_base_commission_cents: 50000 });
  await expect(page.getByText(/Sin configurar: una venta de este producto/)).toHaveCount(0);

  await page.goto("/admin/alertas?category=COMISIONES");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText(alertText, { exact: true })).toHaveCount(0);

  // Ahora sí: VENDIDA; la ficha muestra el desglose CONGELADO.
  await page.goto(`/admin/ventas/${state.blockedSaleId}`);
  await page.getByRole("button", { name: "Marcar como vendida" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Marcar como vendida" }).click();
  await expect(page.getByText("Venta marcada como vendida.")).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => saleStatus(state.blockedSaleId)).toBe("SOLD");
  await expect(page.getByRole("heading", { name: "Comisión de vendedor" })).toBeVisible();
  await expectBreakdown(page.locator(`dl[aria-label="Comisión congelada · ${FRESH_NAME}"]`), [
    ["Precio fijo utilizado", 450000],
    ["Comisión fija utilizada", 50000],
    ["Precio final de venta", 470000],
    ["Adicional generado", 20000],
    ["Para el vendedor", 10000],
    ["Para la tienda", 10000],
    ["Comisión total", 60000],
  ]);
});

test("13 · Vendedor: el formulario completa el precio fijo, no deja bajar de él y estima la comisión en vivo", async ({ page }) => {
  await login(page, SELLER_EMAIL);
  await page.goto("/seller/ventas/nueva/cuba");
  const units = page.locator("#section-units");
  const search = units.getByPlaceholder("Buscar en catálogo…");
  const salePrice = units.getByLabel(/^Precio de venta/);
  const estimate = units.locator('dl[aria-label="Comisión estimada · unidad 1"]');

  // Producto N1 ($3,500 / $350) → precio sugerido $3,500 y comisión $350.
  await search.fill(`${PREFIX} N1`);
  await units.getByRole("button", { name: new RegExp(`${PREFIX} N1`) }).click();
  await expect(salePrice).toHaveValue("3500.00");
  await expect(units.getByText("$350.00").first()).toBeVisible();

  // Cambiar de producto → precio y comisión con la configuración del NUEVO producto.
  await units.getByRole("button", { name: "Cambiar" }).click();
  await units.getByPlaceholder("Buscar en catálogo…").fill(EXAMPLE_NAME);
  await units.getByRole("button", { name: new RegExp(EXAMPLE_NAME) }).click();
  await expect(salePrice).toHaveValue("4500.00");
  await expectBreakdown(estimate, [["Precio fijo", 450000], ["Comisión fija", 50000], ["Comisión total", 50000]]);

  // Subir el precio recalcula al instante: $4,700 → $600.
  await salePrice.fill("4700");
  await expectBreakdown(estimate, [
    ["Precio de venta", 470000],
    ["Adicional generado", 20000],
    ["Para el vendedor", 10000],
    ["Para la tienda", 10000],
    ["Comisión total", 60000],
  ]);
  await expect(page.getByText("Tu comisión estimada").first()).toBeVisible();

  // Por debajo del precio fijo: error inmediato y sin estimación.
  await salePrice.fill("4400");
  await expect(units.getByText("No puede ser inferior al precio fijo ($4,500.00).")).toBeVisible();
  await expect(estimate).toHaveCount(0);

  // Producto sin configurar: aviso con enlace a la ficha y precio bloqueado.
  await units.getByRole("button", { name: "Cambiar" }).click();
  await units.getByPlaceholder("Buscar en catálogo…").fill(FRESH2_NAME);
  await units.getByRole("button", { name: new RegExp(FRESH2_NAME) }).click();
  const warning = units.getByRole("alert").filter({ hasText: "no tiene precio fijo de venta o comisión fija" });
  await expect(warning).toBeVisible();
  await expect(warning.getByRole("link", { name: "ficha del producto" })).toHaveAttribute("href", /\/admin\/productos\/[0-9a-f-]{36}$/);
  await expect(salePrice).toBeDisabled();
});

test("14 · Fichas de venta: desglose congelado (VENDIDA) y estimado (PENDIENTE); el vendedor no edita productos", async ({ page }) => {
  await login(page, SELLER_EMAIL);
  await page.goto(`/seller/ventas/${state.soldSaleId}`);
  await expect(page.getByRole("heading", { name: /Tu comisión/ })).toBeVisible();
  await expectBreakdown(page.locator(`dl[aria-label="Comisión congelada · ${EXAMPLE_NAME}"]`), [
    ["Precio fijo utilizado", 450000],
    ["Comisión fija utilizada", 50000],
    ["Precio final de venta", 470000],
    ["Adicional generado", 20000],
    ["Para el vendedor", 10000],
    ["Para la tienda", 10000],
    ["Comisión total", 60000],
  ]);

  await page.goto(`/seller/ventas/${state.pendingSaleId}`);
  await expect(page.getByRole("heading", { name: /Tu comisión estimada/ })).toBeVisible();
  await expectBreakdown(page.locator(`dl[aria-label="Comisión estimada · ${EXAMPLE_NAME}"]`), [
    ["Precio de venta", 500000],
    ["Adicional generado", 50000],
    ["Para el vendedor", 25000],
    ["Para la tienda", 25000],
    ["Comisión total", 75000],
  ]);

  // El vendedor no puede abrir la ficha de producto (ni sus campos de precio fijo / comisión).
  await page.goto(`/admin/productos/${state.exampleId}`);
  await expect(page).toHaveURL(/\/seller$/);
  await expect(page.getByLabel("Precio fijo de venta (USD)")).toHaveCount(0);
});

test("15 · Limpieza: no queda ningún producto ni valor de prueba cargado", async ({ page }) => {
  const ids = [...state.productIds];
  await cleanup();
  const { data: remaining } = await svc.from("products").select("id").in("id", ids);
  expect(remaining).toEqual([]);
  expect(await leftoverTestProducts(svc)).toEqual([]);
  expect(await snapshotRealProducts(svc)).toEqual(state.baseline);

  await login(page, ADMIN_EMAIL);
  await page.goto(`/admin/productos?q=${encodeURIComponent(PREFIX)}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: PREFIX })).toHaveCount(0);
});
