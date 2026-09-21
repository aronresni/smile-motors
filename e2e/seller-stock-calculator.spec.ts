import { execFileSync } from "node:child_process";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { commissionTier } from "../supabase/scripts/fixtures/commission-test-products.mjs";
import { E2E_PASSWORD } from "./credentials";

/**
 * STOCK (catálogo) + CALCULADORA del vendedor, en un teléfono (375 px).
 *
 * Comprueba lo que de verdad importa: que el catálogo no reintroduce VIN ni
 * cantidades, que la cuenta se hace en NETO (lo que entra, no lo aprobado) y
 * que "Convertir en venta" deja un BORRADOR — nunca una venta confirmada.
 *
 * Crea su propio producto y borra todo lo que crea.
 */
try {
  process.loadEnvFile(path.resolve(__dirname, "../.env.local"));
} catch {
  /* sin .env.local: las pruebas fallarán con un mensaje claro */
}

const ADMIN_EMAIL = "e2e-smile-admin@motods.test";
const SELLER_EMAIL = "e2e-smile-seller@motods.test";
const PASSWORD = E2E_PASSWORD;
const T3 = commissionTier(3); // precio fijo $3,999 · comisión $400
const PRICE = T3.fixedPriceCents;
const PRICE_INPUT = (PRICE / 100).toFixed(2);

test.describe.configure({ mode: "serial" });

const fixture = {
  productId: "",
  productName: "",
  saleIds: [] as string[],
  method: { id: "", name: "" },
  plan: { id: "", label: "", feeBps: 0, termMonths: 0 },
};
let svc: SupabaseClient;

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const bpsFee = (cents: number, bps: number) => Math.round((cents * bps) / 10000);

async function client(email: string) {
  const c = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
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
      ["--env-file=.env.local", "supabase/scripts/create-user.mjs", "--sandbox", "--email", email, "--password", PASSWORD, "--role", role, "--name", name],
      { cwd, stdio: "ignore" },
    );
  }

  svc = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const admin = await client(ADMIN_EMAIL);
  fixture.productName = `E2E STOCK ${Date.now().toString(36).toUpperCase()}`;
  const { data: p } = await admin.c.rpc("admin_create_product", {
    p_name: fixture.productName, p_brand: "E2E", p_category: "E2E STOCK",
    p_base_price_cents: PRICE, p_cuba_total_cents: PRICE, p_is_active: true,
  });
  fixture.productId = (p as { productId: string }).productId;
  // Sin dígitos en el nombre del color: la prueba 2 verifica que NO hay ningún
  // número junto a los colores (nunca más cantidades por color).
  for (const color of ["Negro", "Rojo", "Azul"]) {
    await admin.c.rpc("admin_create_product_variant", {
      p_product_id: fixture.productId, p_color_name: color,
    });
  }
  await admin.c.rpc("admin_update_product_commission_defaults", {
    p_product_id: fixture.productId,
    p_default_reference_price_cents: PRICE,
    p_default_base_commission_cents: T3.fixedCommissionCents,
  });

  // Financiera REAL de la base: activa, a plazos y con plazo configurado.
  const { data: methods } = await svc
    .from("payment_methods")
    .select("id, name, fee_strategy, only_florida")
    .eq("is_active", true)
    .eq("fee_strategy", "INSTALLMENTS")
    .eq("only_florida", false);
  const { data: plans } = await svc
    .from("payment_method_plans")
    .select("id, payment_method_id, label, fee_bps, term_months")
    .eq("is_active", true)
    .not("term_months", "is", null);
  const plan = (plans ?? []).find((pl) =>
    (methods ?? []).some((m) => m.id === pl.payment_method_id),
  );
  const method = (methods ?? []).find((m) => m.id === plan?.payment_method_id);
  if (!plan || !method) throw new Error("No hay financiera a plazos activa para la prueba");
  fixture.method = { id: method.id, name: method.name };
  fixture.plan = {
    id: plan.id, label: plan.label, feeBps: plan.fee_bps, termMonths: plan.term_months!,
  };
});

test.afterAll(async () => {
  for (const id of fixture.saleIds) await svc.from("sales").delete().eq("id", id);
  if (fixture.productId) {
    await svc.from("product_catalog_events").delete().eq("product_id", fixture.productId);
    await svc.from("product_variants").delete().eq("product_id", fixture.productId);
    await svc.from("products").delete().eq("id", fixture.productId);
  }
});

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
});

async function loginSeller(page: Page) {
  await page.request.post("/auth/signout");
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill(SELLER_EMAIL);
  await page.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: /iniciar sesión/i }).click();
  await page.waitForURL(/\/seller$/, { timeout: 30_000 });
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

/** Abre la calculadora con el producto de prueba ya puesto. */
async function openCalculator(page: Page) {
  await page.goto(`/seller/calculadora?producto=${fixture.productId}`);
  await expect(page.getByText(fixture.productName)).toBeVisible({ timeout: 20_000 });
}

/** Agrega una aprobación desde el cajón de métodos. */
async function addApproval(page: Page, search: string, amountLabel: string, plan?: string) {
  await page.getByRole("button", { name: "Agregar", exact: true }).click();
  await page.getByLabel("Buscar método de pago").fill(search);
  await page.getByRole("button", { name: "Simular" }).first().click();
  const dialog = page.getByRole("dialog");
  if (plan) await dialog.getByRole("button", { name: new RegExp(plan, "i") }).first().click();
  await dialog.getByLabel(amountLabel).fill(PRICE_INPUT);
  return dialog;
}

test("1 · Stock: catálogo activo, sin VIN ni cantidades", async ({ page }) => {
  await loginSeller(page);

  // La barra inferior lleva a Stock (la palabra del vendedor para el catálogo).
  const nav = page.getByRole("navigation", { name: "Navegación del vendedor" }).first();
  await nav.getByRole("link", { name: "Stock" }).click();
  await page.waitForURL(/\/seller\/stock$/);

  await page.getByPlaceholder("Buscar por modelo o marca…").fill(fixture.productName);
  const card = page.getByRole("link", { name: new RegExp(fixture.productName) });
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card).toContainText(money(PRICE));
  await expect(card).toContainText("Disponible");

  const body = await page.locator("main").innerText();
  expect(body).not.toMatch(/\bVIN\b/);
  expect(body).not.toMatch(/Cantidad reportada|Reservad[ao]s?\b|unidades\b/i);
  await expectNoHorizontalOverflow(page);
});

test("2 · Colores sin cantidades al lado", async ({ page }) => {
  await loginSeller(page);
  await page.goto(`/seller/stock/${fixture.productId}`);

  const colors = page.getByRole("group", { name: "Colores disponibles" });
  await expect(colors).toBeVisible({ timeout: 20_000 });
  for (const color of ["negro", "rojo", "azul"]) {
    await expect(colors.getByRole("button", { name: new RegExp(color, "i") })).toBeVisible();
  }
  // Ni un número junto a los colores: el catálogo no cuenta unidades.
  expect(await colors.innerText()).not.toMatch(/\d/);
  await expectNoHorizontalOverflow(page);
});

test("3 · Del producto a la calculadora, ya preseleccionado", async ({ page }) => {
  await loginSeller(page);
  await page.goto(`/seller/stock/${fixture.productId}`);
  await page.getByRole("button", { name: "Usar en calculadora" }).click();
  await page.waitForURL(/\/seller\/calculadora\?producto=/);

  await expect(page.getByText(fixture.productName)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel("Precio pactado")).toHaveValue(PRICE_INPUT);
  await expect(page.getByText("Total a cubrir").first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("4 · Bruto, lo que descuenta la financiera y el neto que falta", async ({ page }) => {
  await loginSeller(page);
  await openCalculator(page);

  const dialog = await addApproval(page, fixture.method.name, "Aprobado (bruto)", fixture.plan.label);

  const fee = bpsFee(PRICE, fixture.plan.feeBps);
  const net = PRICE - fee;
  await expect(dialog).toContainText(`−${money(fee)}`);
  await expect(dialog).toContainText(money(net));
  // Cuota mensual: división simple del bruto entre el plazo, nada de TAE.
  await expect(dialog).toContainText(money(Math.round(PRICE / fixture.plan.termMonths)));

  await dialog.getByRole("button", { name: "Agregar", exact: true }).click();

  // La cobertura se mide en NETO: aprobar el total NO cubre la venta.
  const coverage = page.getByRole("group", { name: "Cobertura de la simulación" });
  await expect(coverage).toContainText(money(net));
  await expect(coverage).toContainText(money(fee)); // lo que falta = el fee
  await expect(coverage).toContainText(`Faltan ${money(fee)}`);
  await expectNoHorizontalOverflow(page);
});

test("5 · Quitar la aprobación devuelve el faltante al instante", async ({ page }) => {
  await loginSeller(page);
  await openCalculator(page);

  const dialog = await addApproval(page, "Zelle", "Paga el cliente");
  await dialog.getByRole("button", { name: "Agregar", exact: true }).click();

  const coverage = page.getByRole("group", { name: "Cobertura de la simulación" });
  await expect(coverage).toContainText("Venta cubierta");

  await page.getByRole("button", { name: /^Quitar Zelle$/i }).click();
  // El faltante vuelve al total en el acto (dt "Falta" + dd con el importe).
  await expect(coverage).toContainText(`Falta${money(PRICE)}`);
  await expect(coverage).toContainText("0% · 0 aprobaciones");
  await expect(
    page.getByText("Agrega una aprobación o método de pago para calcular cuánto falta cubrir."),
  ).toBeVisible();
});

test("6 · Convertir en venta: BORRADOR, sin contratos ni pagos", async ({ page }) => {
  await loginSeller(page);
  await openCalculator(page);

  // Zelle cubre el total exacto (sin comisión): 100 %.
  const dialog = await addApproval(page, "Zelle", "Paga el cliente");
  await dialog.getByRole("button", { name: "Agregar", exact: true }).click();
  await expect(
    page.getByRole("group", { name: "Cobertura de la simulación" }),
  ).toContainText("Venta cubierta");

  await page.getByRole("button", { name: /Convertir en venta/ }).last().click();
  await page.waitForURL(/\/seller\/ventas\/[0-9a-f-]{36}$/, { timeout: 60_000 });

  const saleId = page.url().split("/").pop()!;
  fixture.saleIds.push(saleId);

  const { data: sale } = await svc.from("sales").select("status").eq("id", saleId).single();
  expect(sale?.status).toBe("DRAFT");

  const { data: contracts } = await svc
    .from("sale_financing_contracts").select("id").eq("sale_id", saleId);
  expect(contracts ?? []).toHaveLength(0);

  const { data: commissions } = await svc
    .from("sale_commissions").select("id").eq("sale_id", saleId);
  expect(commissions ?? []).toHaveLength(0);

  const { data: allocations } = await svc
    .from("sale_payment_allocations")
    .select("settlement_status, settled_at, gross_amount_cents")
    .eq("sale_id", saleId);
  expect(allocations ?? []).toHaveLength(1);
  expect(allocations![0].settled_at).toBeNull();

  // El producto y el importe llegaron al borrador.
  const { data: units } = await svc
    .from("sale_units").select("product_id, agreed_price_cents").eq("sale_id", saleId);
  expect(units?.[0]?.product_id).toBe(fixture.productId);
  expect(Number(units?.[0]?.agreed_price_cents)).toBe(PRICE);
});

test("7 · Si algo cambió durante la simulación, se avisa antes de convertir", async ({ page }) => {
  await loginSeller(page);
  await page.goto(`/seller/stock/${fixture.productId}`);

  // El vendedor elige un color y se lo lleva a la calculadora.
  const colors = page.getByRole("group", { name: "Colores disponibles" });
  await colors.getByRole("button", { name: /rojo/i }).click();
  await page.getByRole("button", { name: "Usar en calculadora" }).click();
  await page.waitForURL(/\/seller\/calculadora\?producto=/);
  await expect(page.getByText(fixture.productName)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("rojo", { exact: false }).first()).toBeVisible();

  const dialog = await addApproval(page, "Zelle", "Paga el cliente");
  await dialog.getByRole("button", { name: "Agregar", exact: true }).click();

  // Mientras tanto, Administración retira ese color del catálogo.
  const admin = await client(ADMIN_EMAIL);
  const { data: variants } = await svc
    .from("product_variants").select("id, color_name").eq("product_id", fixture.productId);
  const rojo = variants!.find((v) => v.color_name.toLowerCase() === "rojo")!;
  await admin.c.rpc("admin_set_product_variant_active", {
    p_variant_id: rojo.id, p_active: false,
  });

  await page.getByRole("button", { name: /Convertir en venta/ }).last().click();

  const warning = page.getByRole("dialog");
  await expect(warning).toContainText("Las condiciones cambiaron desde que comenzaste la simulación.");
  await expect(warning).toContainText("El color elegido");

  await warning.getByRole("button", { name: "Continuar con los valores actuales" }).click();
  await page.waitForURL(/\/seller\/ventas\/[0-9a-f-]{36}$/, { timeout: 60_000 });

  const saleId = page.url().split("/").pop()!;
  fixture.saleIds.push(saleId);

  const { data: sale } = await svc.from("sales").select("status").eq("id", saleId).single();
  expect(sale?.status).toBe("DRAFT");
  // El borrador se creó SIN el color retirado (no se arrastra lo inválido).
  const { data: units } = await svc
    .from("sale_units").select("product_variant_id").eq("sale_id", saleId);
  expect(units?.[0]?.product_variant_id).toBeNull();

  await admin.c.rpc("admin_set_product_variant_active", {
    p_variant_id: rojo.id, p_active: true,
  });
});
