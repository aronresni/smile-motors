import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const ADMIN_EMAIL = "e2e-sm-admin@motods.test";
const SELLER_EMAIL = "e2e-sm-seller@motods.test";
const PASSWORD = "E2E-Test-Pw-1!";

test.beforeAll(() => {
  const cwd = path.resolve(__dirname, "..");
  for (const [email, role] of [[ADMIN_EMAIL, "admin"], [SELLER_EMAIL, "seller"]] as const) {
    execFileSync(
      "node",
      ["--env-file=.env.local", "supabase/scripts/create-user.mjs", "--email", email, "--password", PASSWORD, "--role", role, "--name", `${role} E2E`],
      { cwd, stdio: "inherit" },
    );
  }
});

async function login(page: Page, email: string) {
  // Cierra cualquier sesión previa explícitamente (POST, misma cookie jar
  // que `page`) — si no, `/login` con una sesión activa redirige de
  // inmediato (proxy.ts, regla 5) y nunca se llega al formulario.
  await page.request.post("/auth/signout");
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: /iniciar sesión/i }).click();
}

test.describe("Gestión de vendedores — verificación de interfaz", () => {
  test("admin: /admin/vendedores carga, muestra el botón de invitar y el modal funciona", async ({ page }) => {
    await login(page, ADMIN_EMAIL);
    await page.waitForURL(/\/admin/, { timeout: 15_000 });

    await page.goto("/admin/vendedores");
    await expect(page.getByRole("heading", { name: "Vendedores" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Invitar vendedor" })).toBeVisible();

    await page.getByRole("button", { name: "Invitar vendedor" }).click();
    await expect(page.getByRole("heading", { name: "Invitar vendedor" })).toBeVisible();
    await expect(page.getByLabel("Nombre/s")).toBeVisible();
    await expect(page.getByLabel("Correo electrónico")).toBeVisible();

    // Validación de cliente: enviar vacío debe mostrar el error, sin llamar al server.
    await page.getByRole("button", { name: "Enviar invitación" }).click();
    await expect(page.getByText("Completa nombre, apellido y correo.")).toBeVisible();
  });

  test("admin: nav Vendedores está habilitada en el shell de admin", async ({ page }) => {
    await login(page, ADMIN_EMAIL);
    await page.waitForURL(/\/admin/, { timeout: 15_000 });
    await page.goto("/admin");
    await page.getByRole("link", { name: "Vendedores", exact: true }).click();
    await page.waitForURL(/\/admin\/vendedores$/);
    await expect(page.getByRole("heading", { name: "Vendedores" })).toBeVisible();
  });

  test("suspended seller cannot reach /seller (server-side block, not just a disabled button)", async ({ page }) => {
    // Suspender via el propio flujo de UI del admin: primero encontrar al
    // vendedor de prueba en la lista y abrir su ficha.
    await login(page, ADMIN_EMAIL);
    await page.waitForURL(/\/admin/, { timeout: 15_000 });
    await page.goto(`/admin/vendedores?q=${encodeURIComponent(SELLER_EMAIL)}`);
    const link = page.getByRole("link", { name: `seller E2E` }).first();
    await expect(link).toBeVisible({ timeout: 10_000 });
    await link.click();
    await page.waitForURL(/\/admin\/vendedores\/[0-9a-f-]+$/);

    // Base conocida: si una corrida anterior dejó al vendedor SUSPENDIDO,
    // reactivar primero (idempotente) antes de probar la suspensión en sí.
    const reactivateFirst = page.getByRole("button", { name: "Reactivar" });
    if (await reactivateFirst.isVisible().catch(() => false)) {
      await reactivateFirst.click();
      await expect(page.getByText("Activo").first()).toBeVisible({ timeout: 10_000 });
    }

    await page.getByRole("button", { name: "Suspender" }).click();
    const suspendDialog = page.getByRole("dialog");
    await expect(suspendDialog.getByRole("heading", { name: "Suspender vendedor" })).toBeVisible();
    await suspendDialog.getByRole("button", { name: "Suspender", exact: true }).click();
    await expect(page.getByText("Suspendido").first()).toBeVisible({ timeout: 10_000 });

    // Ahora el vendedor intenta entrar — server-side lo bloquea aunque su
    // sesión de Supabase siga siendo válida.
    await login(page, SELLER_EMAIL);
    await expect(page.getByText(/no está habilitada/i)).toBeVisible({ timeout: 10_000 });
    await page.goto("/seller");
    await page.waitForURL(/\/login/, { timeout: 10_000 });

    // Reactivar para dejar todo limpio.
    await login(page, ADMIN_EMAIL);
    await page.waitForURL(/\/admin/, { timeout: 15_000 });
    await page.goto(`/admin/vendedores?q=${encodeURIComponent(SELLER_EMAIL)}`);
    await page.getByRole("link", { name: `seller E2E` }).first().click();
    await page.getByRole("button", { name: "Reactivar" }).click();
    await expect(page.getByText("Activo").first()).toBeVisible({ timeout: 10_000 });

    await login(page, SELLER_EMAIL);
    await page.waitForURL(/\/seller/, { timeout: 15_000 });
  });
});
