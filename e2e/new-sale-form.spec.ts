import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { E2E_PASSWORD } from "./credentials";

/**
 * Prueba OBLIGATORIA (no basta con `/dev/ocr-fixtures`): sube las mismas
 * imágenes sintéticas al formulario REAL de "Nueva venta" y comprueba que
 * los campos de React Hook Form se autocompletan de verdad — comprador (ID
 * de EE. UU.) y destinatario en Cuba (carné cubano).
 */

const TEST_EMAIL = "e2e-seller@motods.test";
const TEST_PASSWORD = E2E_PASSWORD;

test.beforeAll(() => {
  // Reutiliza el script de alta existente (idempotente) — mismo patrón que
  // los demás scripts de `supabase/scripts/`. Requiere `.env.local`.
  execFileSync(
    "node",
    [
      "--env-file=.env.local",
      "supabase/scripts/create-user.mjs",
      "--email", TEST_EMAIL,
      "--password", TEST_PASSWORD,
      "--role", "seller",
      "--name", "Vendedor E2E",
    ],
    { cwd: path.resolve(__dirname, ".."), stdio: "inherit" },
  );
});

async function dataUrlToBuffer(dataUrl: string): Promise<Buffer> {
  const base64 = dataUrl.split(",")[1];
  return Buffer.from(base64, "base64");
}

/** Genera el par frente/reverso sintético en `/dev/ocr-fixtures` y devuelve
 * los data URLs (leídos directamente del DOM, no reimplementados aquí). */
async function generateFixtureDataUrls(
  page: Page,
  testId: string,
): Promise<{ front: string; back: string }> {
  await page.goto("/dev/ocr-fixtures");
  await page.getByTestId(`${testId}-generate-synthetic`).click();
  const section = page.getByTestId(testId);
  await expect(section.getByText("Quitar")).toHaveCount(2, { timeout: 20_000 });
  const front = await section.getByAltText("Frente").getAttribute("src");
  const back = await section.getByAltText("Reverso").getAttribute("src");
  if (!front || !back) throw new Error("No se generaron las imágenes sintéticas");
  return { front, back };
}

async function login(page: Page) {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(TEST_EMAIL);
  await page.locator('input[type="password"]').fill(TEST_PASSWORD);
  await page.getByRole("button", { name: /iniciar sesión/i }).click();
  await page.waitForURL(/\/seller/, { timeout: 15_000 });
}

/** Sube un archivo a un `DocumentUploader` (input oculto) y confirma el
 * recorte (modal "Guardar") — el mismo flujo real que usa el vendedor. */
async function uploadDocument(
  page: Page,
  fileInput: ReturnType<Page["locator"]>,
  buffer: Buffer,
  name: string,
  mimeType = "image/png",
) {
  await fileInput.setInputFiles({ name, mimeType, buffer });
  const saveButton = page.getByRole("button", { name: "Guardar", exact: true });
  await expect(saveButton).toBeVisible({ timeout: 10_000 });
  await saveButton.click();
  await expect(saveButton).toBeHidden({ timeout: 10_000 });
}

test.describe("Nueva venta (Cuba) — fotos desde la galería", () => {
  test("el selector abre la GALERÍA por defecto; la cámara solo con 'Tomar foto con la cámara'", async ({ page }) => {
    const { front } = await generateFixtureDataUrls(page, "us-license");
    await login(page);
    await page.goto("/seller/ventas/nueva/cuba");
    const buyer = page.locator("#section-buyer");
    await expect(buyer).toBeVisible({ timeout: 15_000 });

    // Sin `capture`, el móvil ofrece la galería/archivos en vez de la cámara.
    let chooser = page.waitForEvent("filechooser");
    await buyer.getByRole("button", { name: /Elegir foto de la galería/ }).first().click();
    expect(await (await chooser).element().getAttribute("capture")).toBeNull();

    // La cámara sigue disponible, pero solo si el vendedor la pide.
    chooser = page.waitForEvent("filechooser");
    await buyer.getByRole("button", { name: "Tomar foto con la cámara" }).first().click();
    const cameraChooser = await chooser;
    expect(await cameraChooser.element().getAttribute("capture")).toBe("environment");

    // Completa la subida por ese mismo selector y confirma el recorte.
    await cameraChooser.setFiles({ name: "front.png", mimeType: "image/png", buffer: await dataUrlToBuffer(front) });
    const saveButton = page.getByRole("button", { name: "Guardar", exact: true });
    await saveButton.click();
    await expect(saveButton).toBeHidden({ timeout: 10_000 });

    // "Reemplazar" vuelve a la galería (el atributo no queda pegado).
    chooser = page.waitForEvent("filechooser");
    await buyer.getByRole("button", { name: "Reemplazar" }).first().click();
    expect(await (await chooser).element().getAttribute("capture")).toBeNull();
  });

  test("comprador: foto COMPRIMIDA de la galería del reverso (baja resolución) → los 9 campos exactos", async ({ page }) => {
    await page.goto("/dev/ocr-fixtures");
    await page.getByTestId("us-license-generate-synthetic-lowres").click();
    const section = page.getByTestId("us-license");
    await expect(section.getByText("Quitar")).toHaveCount(1, { timeout: 20_000 });
    const back = await section.getByAltText("Reverso").getAttribute("src");
    if (!back) throw new Error("No se generó el reverso sintético");

    await login(page);
    await page.goto("/seller/ventas/nueva/cuba");
    await expect(page.locator("#section-buyer")).toBeVisible({ timeout: 15_000 });
    const inputs = page.locator("#section-buyer input[type='file']");
    await uploadDocument(page, inputs.nth(1), await dataUrlToBuffer(back), "reverso.jpg", "image/jpeg");

    await expect(page.locator('input[name="buyer.firstName"]')).toHaveValue("Rolando", { timeout: 45_000 });
    await expect(page.locator('input[name="buyer.lastName"]')).toHaveValue("Quintana Bermudez");
    await expect(page.locator('input[name="buyer.documentNumber"]')).toHaveValue("R512448907710");
    await expect(page.locator('input[name="buyer.dateOfBirth"]')).toHaveValue("1971-07-09");
    await expect(page.locator('input[name="buyer.documentExpiration"]')).toHaveValue("2032-07-09");
    await expect(page.locator('input[name="buyer.addressLine1"]')).toHaveValue("2280 Sunset Palm Way");
    await expect(page.locator('input[name="buyer.city"]')).toHaveValue("Kissimmee");
    await expect(page.locator('select[name="buyer.state"]')).toHaveValue("FL");
    await expect(page.locator('input[name="buyer.postalCode"]')).toHaveValue("34746");
  });
});

test.describe("Nueva venta (Cuba) — autocompletado real desde documentos", () => {
  test("comprador: sube ID de EE. UU. sintético → los campos de React Hook Form se autocompletan", async ({ page }) => {
    const { front, back } = await generateFixtureDataUrls(page, "us-license");
    const frontBuf = await dataUrlToBuffer(front);
    const backBuf = await dataUrlToBuffer(back);

    await login(page);
    await page.goto("/seller/ventas/nueva/cuba");
    await expect(page.locator("#section-buyer")).toBeVisible({ timeout: 15_000 });

    const inputs = page.locator("#section-buyer input[type='file']");
    await uploadDocument(page, inputs.nth(0), frontBuf, "front.png");
    await uploadDocument(page, inputs.nth(1), backBuf, "back.png");

    // El PDF417 (WASM local) debe decodificar y autocompletar via AAMVA.
    await expect(page.locator('input[name="buyer.firstName"]')).toHaveValue("Patricia Ann", { timeout: 30_000 });
    await expect(page.locator('input[name="buyer.lastName"]')).toHaveValue("Morales");
    await expect(page.locator('input[name="buyer.documentNumber"]')).toHaveValue("Z99887766");
    await expect(page.locator('input[name="buyer.dateOfBirth"]')).toHaveValue("1985-03-12");
    await expect(page.locator('select[name="buyer.state"]')).toHaveValue("NE");
    await expect(page.locator('input[name="buyer.postalCode"]')).toHaveValue("68601");
  });

  test("destinatario en Cuba: sube carné cubano sintético → los campos se autocompletan", async ({ page }) => {
    const { front, back } = await generateFixtureDataUrls(page, "cuban-id");
    const frontBuf = await dataUrlToBuffer(front);
    const backBuf = await dataUrlToBuffer(back);

    await login(page);
    await page.goto("/seller/ventas/nueva/cuba");
    await expect(page.locator("#section-recipient")).toBeVisible({ timeout: 15_000 });
    await page.locator("#section-recipient").scrollIntoViewIfNeeded();

    const inputs = page.locator("#section-recipient input[type='file']");
    await uploadDocument(page, inputs.nth(0), frontBuf, "front.png");
    await uploadDocument(page, inputs.nth(1), backBuf, "back.png");

    await expect(page.locator('input[name="cubaRecipient.fullName"]')).toHaveValue("Yanelis Perez Suarez", { timeout: 30_000 });
    await expect(page.locator('input[name="cubaRecipient.identityNumber"]')).toHaveValue("99010512345");

    // NUNCA se autocompletan desde el documento (campo operativo aparte):
    await expect(page.locator('input[name="cubaRecipient.deliveryAddress"]')).toHaveValue("");
    await expect(page.locator('input[name="cubaRecipient.municipality"]')).toHaveValue("");
  });
});
