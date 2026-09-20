import { execFileSync } from "node:child_process";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { E2E_PASSWORD } from "./credentials";

const ADMIN_EMAIL = "e2e-sm-admin@motods.test";
const SELLER_EMAIL = "e2e-sm-seller@motods.test";
const PASSWORD = E2E_PASSWORD;

test.beforeAll(() => {
  const cwd = path.resolve(__dirname, "..");
  for (const [email, role] of [[ADMIN_EMAIL, "admin"], [SELLER_EMAIL, "seller"]] as const) {
    execFileSync(
      "node",
      ["--env-file=.env.local", "supabase/scripts/create-user.mjs", "--sandbox", "--email", email, "--password", PASSWORD, "--role", role, "--name", `${role} E2E`],
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

  test("invitación completa: el admin obtiene el enlace, el invitado crea su contraseña y entra; después inicia sesión normal", async ({ page, context }) => {
    // Flujo largo: admin + dos navegadores invitados.
    test.setTimeout(180_000);
    const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const stamp = Date.now().toString(36);
    const email = `e2e-invitado-${stamp}@motods.test`;
    const newPassword = `Invitado-${stamp}-9x!`;

    try {
      await login(page, ADMIN_EMAIL);
      await page.waitForURL(/\/admin/, { timeout: 15_000 });
      await page.goto("/admin/vendedores");
      await page.getByRole("button", { name: "Invitar vendedor" }).click();
      await page.getByLabel("Nombre/s").fill("Invitado");
      await page.getByLabel("Apellido/s").fill("E2E");
      await page.getByLabel("Correo electrónico").fill(email);
      await page.getByRole("button", { name: "Enviar invitación" }).click();

      // El enlace se muestra al admin para entregárselo al vendedor.
      const linkBox = page.getByTestId("invite-link");
      await expect(linkBox).toBeVisible({ timeout: 20_000 });
      const inviteUrl = (await linkBox.innerText()).trim();
      expect(inviteUrl).toContain("/auth/invitacion?token_hash=");

      // Queda como INVITADO y todavía NO puede iniciar sesión.
      const { data: invited } = await svc.from("profiles").select("account_status, is_active, role").eq("email", email).single();
      expect(invited).toMatchObject({ account_status: "INVITED", is_active: false, role: "seller" });

      // "Reenviar invitación" da un enlace NUEVO y anula el anterior.
      await page.keyboard.press("Escape");
      await page.goto(`/admin/vendedores?q=${encodeURIComponent(email)}`);
      await page.getByRole("link", { name: "Invitado E2E" }).first().click();
      await page.waitForURL(/\/admin\/vendedores\/[0-9a-f-]+$/);
      await page.getByRole("button", { name: "Reenviar invitación" }).click();
      const resentBox = page.getByTestId("invite-link");
      await expect(resentBox).toBeVisible({ timeout: 20_000 });
      const resentUrl = (await resentBox.innerText()).trim();
      expect(resentUrl).not.toBe(inviteUrl);

      const stale = await context.browser()!.newContext();
      const stalePage = await stale.newPage();
      await stalePage.goto(inviteUrl.replace(/^https?:\/\/[^/]+/, ""));
      await stalePage.waitForURL(/\/login\?error=invite_invalid/, { timeout: 20_000 });
      await stale.close();

      // El invitado abre el enlace vigente en su propio navegador (sesión aparte).
      const guest = await context.browser()!.newContext();
      const guestPage = await guest.newPage();
      await guestPage.goto(resentUrl.replace(/^https?:\/\/[^/]+/, ""));
      await guestPage.waitForURL(/\/auth\/accept-invite$/, { timeout: 20_000 });
      await expect(guestPage.getByRole("heading", { name: /Bienvenido|Activa tu cuenta/ })).toBeVisible();

      await guestPage.getByLabel("Nueva contraseña").fill(newPassword);
      await guestPage.getByLabel("Confirmar contraseña").fill(newPassword);
      await guestPage.getByRole("button", { name: "Activar mi cuenta" }).click();
      await guestPage.waitForURL(/\/seller$/, { timeout: 30_000 });

      // Cuenta activa y con acceso normal por el login de siempre.
      const { data: active } = await svc.from("profiles").select("account_status, is_active").eq("email", email).single();
      expect(active).toMatchObject({ account_status: "ACTIVE", is_active: true });

      await guestPage.request.post("/auth/signout");
      await guestPage.goto("/login");
      await guestPage.locator('input[type="email"]').fill(email);
      await guestPage.locator('input[type="password"]').fill(newPassword);
      await guestPage.getByRole("button", { name: /iniciar sesión/i }).click();
      await guestPage.waitForURL(/\/seller$/, { timeout: 30_000 });

      // El enlace es de un solo uso: reabrirlo ya no da acceso.
      const second = await context.browser()!.newContext();
      const secondPage = await second.newPage();
      await secondPage.goto(resentUrl.replace(/^https?:\/\/[^/]+/, ""));
      await secondPage.waitForURL(/\/login\?error=invite_invalid/, { timeout: 20_000 });
      await expect(secondPage.getByText(/ya se usó o caducó/i)).toBeVisible();
      await second.close();
      await guest.close();
    } finally {
      // La prueba borra lo que creó: la invitación (si no, queda huérfana al
      // borrar el usuario) y la cuenta.
      await svc.from("seller_invitations").delete().eq("email", email);
      const { data: users } = await svc.auth.admin.listUsers({ perPage: 200 });
      const created = users.users.find((u) => u.email === email);
      if (created) await svc.auth.admin.deleteUser(created.id);
    }
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
