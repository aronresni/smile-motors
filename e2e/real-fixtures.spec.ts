import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { E2E_PASSWORD } from "./credentials";

/**
 * Prueba de ACEPTACIÓN con las 4 fotos REALES de la tarea (no sintéticas).
 * Se ejecuta SOLO si existen en `supabase/dev-fixtures/` (carpeta gitignored
 * — ver su README). Si no están, las pruebas se saltan (no fallan) para no
 * romper `npm run test:e2e` en una máquina sin esas fotos.
 *
 * NO HAY NINGÚN VALOR ESPERADO CODIFICADO AQUÍ — solo se verifica que el
 * pipeline real produzca AUTOCOMPLETADO ÚTIL en el formulario real. Nunca se
 * compara contra un nombre/número fijo de esta persona.
 *
 * PRIVACIDAD: la consola solo imprime el resumen del panel de depuración
 * (conteos/estado, sin el bloque JSON de campos) y, para el formulario real,
 * solo si cada campo quedó "poblado" o "vacío" — nunca el valor extraído en
 * sí. No se escribe ningún archivo con los datos extraídos.
 */

const FIXTURES_DIR = path.resolve(__dirname, "..", "supabase", "dev-fixtures");
const FILES = {
  usFront: path.join(FIXTURES_DIR, "us-license-front-real.jpg"),
  usBack: path.join(FIXTURES_DIR, "us-license-back-real.jpg"),
  cuFront: path.join(FIXTURES_DIR, "cuba-id-front-real.jpg"),
  cuBack: path.join(FIXTURES_DIR, "cuba-id-back-real.jpg"),
};

const haveRealFixtures = Object.values(FILES).every((f) => fs.existsSync(f));

test.describe("Fotos REALES (aceptación)", () => {
  test.skip(!haveRealFixtures, `Faltan fixtures reales en ${FIXTURES_DIR} — se salta esta prueba.`);

  const TEST_EMAIL = "e2e-seller@motods.test";
  const TEST_PASSWORD = E2E_PASSWORD;

  test.beforeAll(() => {
    if (!haveRealFixtures) return;
    execFileSync(
      "node",
      ["--env-file=.env.local", "supabase/scripts/create-user.mjs",
        "--email", TEST_EMAIL, "--password", TEST_PASSWORD, "--role", "seller", "--name", "Vendedor E2E"],
      { cwd: path.resolve(__dirname, ".."), stdio: "inherit" },
    );
  });

  async function login(page: Page) {
    await page.goto("/login");
    await page.locator('input[type="email"]').fill(TEST_EMAIL);
    await page.locator('input[type="password"]').fill(TEST_PASSWORD);
    await page.getByRole("button", { name: /iniciar sesión/i }).click();
    await page.waitForURL(/\/seller/, { timeout: 15_000 });
  }

  test("US real: /dev/ocr-fixtures con las fotos reales del Florida DL", async ({ page }) => {
    await page.goto("/dev/ocr-fixtures");
    const section = page.getByTestId("us-license");
    // El Picker del arnés desmonta el <input> al fijar un valor (aparece
    // "Quitar" en su lugar) — hay que volver a consultar el locator cada
    // vez, no fijar los índices de antemano.
    await section.locator("input[type='file']").first().setInputFiles(FILES.usFront);
    await expect(section.getByText("Quitar")).toHaveCount(1, { timeout: 15_000 });
    await section.locator("input[type='file']").first().setInputFiles(FILES.usBack);
    await expect(section.getByText("Quitar")).toHaveCount(2, { timeout: 15_000 });

    await page.getByTestId("us-license-extract").click();
    const resultPanel = page.getByTestId("us-license-result");
    await expect(resultPanel.getByText("Veredicto final:")).toBeVisible({ timeout: 45_000 });
    const resultText = await resultPanel.innerText();

    console.log("\n=== US real — /dev/ocr-fixtures ===");
    console.log(resultText.split("Campos extraídos")[0]); // resumen, sin JSON de campos (evita PII en logs)

    // No debe quedar completamente vacío.
    expect(resultText).not.toContain("Veredicto final:\nERROR");
    const fieldsMatch = /Campos detectados:\s*\n?(\d+)/.exec(resultText);
    const fieldCount = fieldsMatch ? Number(fieldsMatch[1]) : 0;
    expect(fieldCount, "debe haber al menos un campo detectado").toBeGreaterThan(0);

    // El reverso (foto comprimida) debe leerse por PDF417: los 9 campos del
    // comprador, todos de origen "pdf417" (sin comparar valores personales).
    const [, sourcesJson] = await resultPanel.locator("pre").allInnerTexts();
    const sources = JSON.parse(sourcesJson) as Record<string, string>;
    expect(Object.keys(sources).sort()).toEqual(
      ["addressLine1", "city", "dateOfBirth", "documentNumber", "expirationDate", "firstName", "lastName", "postalCode", "state"],
    );
    expect(Object.values(sources).every((s) => s === "pdf417")).toBe(true);
  });

  test("US real: formulario REAL de Nueva Venta con las fotos reales del Florida DL", async ({ page }) => {
    await login(page);
    await page.goto("/seller/ventas/nueva/cuba");
    await expect(page.locator("#section-buyer")).toBeVisible({ timeout: 15_000 });

    const inputs = page.locator("#section-buyer input[type='file']");

    await inputs.nth(0).setInputFiles(FILES.usFront);
    let saveButton = page.getByRole("button", { name: "Guardar", exact: true });
    await expect(saveButton).toBeVisible({ timeout: 10_000 });
    await saveButton.click();
    await expect(saveButton).toBeHidden({ timeout: 10_000 });

    // Da tiempo a la extracción preliminar del frente antes de subir el reverso.
    await page.waitForTimeout(2000);

    await inputs.nth(1).setInputFiles(FILES.usBack);
    saveButton = page.getByRole("button", { name: "Guardar", exact: true });
    await expect(saveButton).toBeVisible({ timeout: 10_000 });
    await saveButton.click();
    await expect(saveButton).toBeHidden({ timeout: 10_000 });

    // Espera a que la extracción (WASM/OCR) termine: algún campo del
    // comprador deja de estar vacío.
    const firstName = page.locator('input[name="buyer.firstName"]');
    const lastName = page.locator('input[name="buyer.lastName"]');
    const docNumber = page.locator('input[name="buyer.documentNumber"]');
    await expect
      .poll(async () => {
        const [fn, ln, dn] = await Promise.all([firstName.inputValue(), lastName.inputValue(), docNumber.inputValue()]);
        return (fn + ln + dn).length;
      }, { timeout: 45_000, message: "esperando autocompletado real del formulario" })
      .toBeGreaterThan(0);

    const values = {
      firstName: await firstName.inputValue(),
      lastName: await lastName.inputValue(),
      documentNumber: await docNumber.inputValue(),
      dateOfBirth: await page.locator('input[name="buyer.dateOfBirth"]').inputValue(),
      documentExpiration: await page.locator('input[name="buyer.documentExpiration"]').inputValue(),
      addressLine1: await page.locator('input[name="buyer.addressLine1"]').inputValue(),
      city: await page.locator('input[name="buyer.city"]').inputValue(),
      state: await page.locator('select[name="buyer.state"]').inputValue(),
      postalCode: await page.locator('input[name="buyer.postalCode"]').inputValue(),
    };
    console.log("\n=== US real — formulario Nueva Venta (campos poblados, no vacíos) ===");
    console.log(Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v ? "✓ poblado" : "— vacío"])));

    const populatedCount = Object.values(values).filter(Boolean).length;
    expect(populatedCount, "los 9 campos del comprador se completan desde el PDF417").toBe(9);
    // "NONE" es el marcador AAMVA de "sin segundo nombre": nunca debe aparecer.
    expect(values.firstName).not.toMatch(/\bNone\b/i);
  });

  test("Cuba real: /dev/ocr-fixtures con las fotos reales del carné", async ({ page }) => {
    await page.goto("/dev/ocr-fixtures");
    const section = page.getByTestId("cuban-id");
    await section.locator("input[type='file']").first().setInputFiles(FILES.cuFront);
    await expect(section.getByText("Quitar")).toHaveCount(1, { timeout: 15_000 });
    await section.locator("input[type='file']").first().setInputFiles(FILES.cuBack);
    await expect(section.getByText("Quitar")).toHaveCount(2, { timeout: 15_000 });

    await page.getByTestId("cuban-id-extract").click();
    const resultPanel = page.getByTestId("cuban-id-result");
    await expect(resultPanel.getByText("Veredicto final:")).toBeVisible({ timeout: 45_000 });
    const resultText = await resultPanel.innerText();

    console.log("\n=== Cuba real — /dev/ocr-fixtures ===");
    console.log(resultText.split("Campos extraídos")[0]);

    expect(resultText).not.toContain("Veredicto final:\nERROR");
    const fieldsMatch = /Campos detectados:\s*\n?(\d+)/.exec(resultText);
    const fieldCount = fieldsMatch ? Number(fieldsMatch[1]) : 0;
    expect(fieldCount, "debe haber al menos un campo detectado").toBeGreaterThan(0);

    // NI y nombre desde la zona legible del reverso; el relleno "<<<" mal
    // leído como letras ("K LLLLLLLL") nunca entra en el nombre.
    const [dataJson, sourcesJson] = await resultPanel.locator("pre").allInnerTexts();
    const data = JSON.parse(dataJson) as Record<string, string>;
    const sources = JSON.parse(sourcesJson) as Record<string, string>;
    expect(data.identityNumber).toMatch(/^\d{11}$/);
    expect(sources.identityNumber).toBe("mrz-back");
    expect(sources.fullName).toBe("mrz-back");
    expect(data.fullName).not.toMatch(/(\p{L})\1{2,}|\b\p{L}\b/u);
  });

  test("Cuba real: formulario REAL de Nueva Venta con las fotos reales del carné", async ({ page }) => {
    await login(page);
    await page.goto("/seller/ventas/nueva/cuba");
    await expect(page.locator("#section-recipient")).toBeVisible({ timeout: 15_000 });
    await page.locator("#section-recipient").scrollIntoViewIfNeeded();

    const inputs = page.locator("#section-recipient input[type='file']");

    await inputs.nth(0).setInputFiles(FILES.cuFront);
    let saveButton = page.getByRole("button", { name: "Guardar", exact: true });
    await expect(saveButton).toBeVisible({ timeout: 10_000 });
    await saveButton.click();
    await expect(saveButton).toBeHidden({ timeout: 10_000 });

    await page.waitForTimeout(2000);

    await inputs.nth(1).setInputFiles(FILES.cuBack);
    saveButton = page.getByRole("button", { name: "Guardar", exact: true });
    await expect(saveButton).toBeVisible({ timeout: 10_000 });
    await saveButton.click();
    await expect(saveButton).toBeHidden({ timeout: 10_000 });

    const fullName = page.locator('input[name="cubaRecipient.fullName"]');
    const identityNumber = page.locator('input[name="cubaRecipient.identityNumber"]');
    await expect
      .poll(async () => {
        const [fn, ci] = await Promise.all([fullName.inputValue(), identityNumber.inputValue()]);
        return (fn + ci).length;
      }, { timeout: 45_000, message: "esperando autocompletado real del formulario" })
      .toBeGreaterThan(0);

    const values = {
      fullName: await fullName.inputValue(),
      identityNumber: await identityNumber.inputValue(),
      deliveryAddress: await page.locator('input[name="cubaRecipient.deliveryAddress"]').inputValue(),
      municipality: await page.locator('input[name="cubaRecipient.municipality"]').inputValue(),
    };
    console.log("\n=== Cuba real — formulario Nueva Venta ===");
    console.log({
      fullName: values.fullName ? "✓ poblado" : "— vacío",
      identityNumber: values.identityNumber ? "✓ poblado" : "— vacío",
      deliveryAddress: values.deliveryAddress === "" ? "✓ vacío (correcto, nunca se autocompleta)" : "⚠ NO debería tener valor",
      municipality: values.municipality === "" ? "✓ vacío (correcto)" : "⚠ NO debería tener valor",
    });

    expect(values.fullName || values.identityNumber, "al menos nombre o NI deben poblarse").toBeTruthy();
    // Nunca se autocompletan desde el documento (campo operativo aparte).
    expect(values.deliveryAddress).toBe("");
    expect(values.municipality).toBe("");
  });
});
