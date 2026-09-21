import { execFileSync } from "node:child_process";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { E2E_PASSWORD } from "./credentials";

/**
 * SMILE MOTORS — login único, redirección por rol, bloqueo de cuenta
 * suspendida, marca (logo oficial real) y responsive de las pantallas clave.
 * Siembra sus propias cuentas con `supabase/scripts/create-user.mjs`.
 */
// Credenciales de Supabase para las llamadas directas (suspender/reactivar).
try {
  process.loadEnvFile(path.resolve(__dirname, "../.env.local"));
} catch {
  /* sin .env.local: las pruebas que lo necesitan fallarán con un mensaje claro */
}

const ADMIN_EMAIL = "e2e-smile-admin@motods.test";
const SELLER_EMAIL = "e2e-smile-seller@motods.test";
const PASSWORD = E2E_PASSWORD;

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
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
});

async function login(page: Page, email: string) {
  await page.request.post("/auth/signout");
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: /iniciar sesión/i }).click();
}

/** El logo oficial se carga (no roto) y se muestra cuadrado (sin estirar). */
async function expectOfficialLogo(page: Page) {
  const logo = page.locator('img[alt="Smile Motors"]:visible').first();
  await expect(logo).toBeVisible();
  const info = await logo.evaluate((img: HTMLImageElement) => {
    const r = img.getBoundingClientRect();
    return { natural: img.naturalWidth, w: r.width, h: r.height, src: img.currentSrc || img.src };
  });
  expect(info.natural).toBeGreaterThan(0);
  expect(Math.abs(info.w - info.h)).toBeLessThanOrEqual(1);
  expect(decodeURIComponent(info.src)).toContain("smile-motors-logo");
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe("Login único y marca", () => {
  test("/login muestra la identidad Smile Motors y un solo formulario", async ({ page }) => {
    await page.request.post("/auth/signout");
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Iniciar sesión" })).toBeVisible();
    await expect(page.getByText("Accede a tu cuenta para continuar.")).toBeVisible();
    await expect(page.getByRole("button", { name: /iniciar sesión/i })).toBeVisible();
    await expectOfficialLogo(page);
    // No existen accesos separados admin/vendedor.
    await expect(page.getByText(/login de administrador|login de vendedor/i)).toHaveCount(0);
  });

  test("credenciales inválidas → mensaje claro, sin error técnico", async ({ page }) => {
    await page.request.post("/auth/signout");
    await page.goto("/login");
    await page.getByLabel("Correo electrónico").fill(SELLER_EMAIL);
    await page.getByLabel("Contraseña", { exact: true }).fill("incorrecta-123");
    await page.getByRole("button", { name: /iniciar sesión/i }).click();
    await expect(page.getByText("El correo electrónico o la contraseña son incorrectos.")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("/register y /forgot-password llevan al login único", async ({ page }) => {
    await page.request.post("/auth/signout");
    await page.goto("/register");
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/forgot-password");
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("Redirección por rol y autorización de zonas", () => {
  test("vendedor: /login → /seller, y /admin le está vedado", async ({ page }) => {
    await login(page, SELLER_EMAIL);
    await page.waitForURL(/\/seller$/, { timeout: 20_000 });
    await expectOfficialLogo(page);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/seller$/);
    await page.goto("/admin/ventas");
    await expect(page).toHaveURL(/\/seller$/);
  });

  test("admin: /login → /admin, con marca, rol visible y política explícita sobre /seller", async ({ page }) => {
    await login(page, ADMIN_EMAIL);
    await page.waitForURL(/\/admin$/, { timeout: 20_000 });
    await expectOfficialLogo(page);
    await expect(page.getByText("Administración").first()).toBeVisible();
    await expect(page.getByTitle("Estás operando con privilegios de administrador")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Acciones rápidas" }).or(page.getByText("Acciones rápidas"))).toBeVisible();
    // ADMIN_CAN_ACCESS_SELLER = true (política explícita en constants.ts).
    const res = await page.goto("/seller");
    expect(res?.status()).toBe(200);
    await expect(page).toHaveURL(/\/seller$/);
  });

  test("vendedor suspendido no accede aunque su sesión siga viva", async ({ page }) => {
    await login(page, SELLER_EMAIL);
    await page.waitForURL(/\/seller$/, { timeout: 20_000 });

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const adminClient = createClient(url, anon, { auth: { persistSession: false } });
    await adminClient.auth.signInWithPassword({ email: ADMIN_EMAIL, password: PASSWORD });
    const sellerClient = createClient(url, anon, { auth: { persistSession: false } });
    const { data: s } = await sellerClient.auth.signInWithPassword({ email: SELLER_EMAIL, password: PASSWORD });
    const sellerId = s.user!.id;

    try {
      const sus = await adminClient.rpc("admin_suspend_seller", { p_seller_id: sellerId, p_reason: "Prueba E2E de bloqueo" });
      expect((sus.data as { ok?: boolean } | null)?.ok).toBe(true);
      await page.goto("/seller");
      await expect(page).toHaveURL(/\/login\?error=no_access/);
      await expect(page.getByText("Tu cuenta no está habilitada")).toBeVisible();
    } finally {
      await adminClient.rpc("admin_reactivate_seller", { p_seller_id: sellerId });
    }
  });
});

test.describe("Admin · navegación y búsqueda", () => {
  test("Ctrl+K abre la búsqueda global y navega con el teclado", async ({ page }) => {
    await login(page, ADMIN_EMAIL);
    await page.waitForURL(/\/admin$/, { timeout: 20_000 });
    // El atajo se registra al hidratar el header: espera a que la página esté quieta.
    await page.waitForLoadState("networkidle");
    await page.keyboard.press("Control+k");
    const box = page.getByRole("combobox", { name: "Buscar" });
    await expect(box).toBeFocused();
    await box.fill("liquid");
    await expect(page.getByRole("option", { name: /Liquidaciones/ })).toBeVisible();
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/admin\/liquidaciones/);
  });

  test("móvil: el drawer de navegación del admin lleva la marca y navega", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await login(page, ADMIN_EMAIL);
    await page.waitForURL(/\/admin$/, { timeout: 20_000 });
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Abrir navegación" }).click();
    const drawer = page.getByRole("dialog", { name: "Navegación de administración" });
    await expect(drawer).toBeVisible();
    await expect(drawer.locator('img[alt="Smile Motors"]')).toBeVisible();
    await drawer.getByRole("link", { name: "Vendedores" }).click();
    await page.waitForURL(/\/admin\/vendedores$/);
    await expect(drawer).toBeHidden();
  });
});

const ADMIN_PAGES = ["/admin", "/admin/ventas", "/admin/vendedores", "/admin/productos", "/admin/aprobaciones", "/admin/comisiones", "/admin/liquidaciones", "/admin/actividad", "/admin/alertas", "/admin/reportes", "/admin/logistica"];
const SELLER_PAGES = ["/seller", "/seller/ventas", "/seller/ventas/nueva/cuba", "/seller/stock", "/seller/calculadora", "/seller/comisiones", "/seller/menu"];

for (const width of [375, 768, 1440]) {
  test(`responsive ${width}px: sin overflow horizontal (admin + vendedor)`, async ({ page }) => {
    // 18 páginas por ancho; en `next dev --webpack` la primera compilación es lenta.
    test.setTimeout(600_000);
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    await login(page, ADMIN_EMAIL);
    await page.waitForURL(/\/admin$/, { timeout: 20_000 });
    for (const p of ADMIN_PAGES) {
      await page.goto(p);
      await expectNoHorizontalOverflow(page);
    }
    await login(page, SELLER_EMAIL);
    await page.waitForURL(/\/seller$/, { timeout: 20_000 });
    for (const p of SELLER_PAGES) {
      await page.goto(p);
      await expectNoHorizontalOverflow(page);
    }
    await page.request.post("/auth/signout");
    await page.goto("/login");
    await expectNoHorizontalOverflow(page);
  });
}
