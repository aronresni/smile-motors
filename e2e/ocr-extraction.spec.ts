import { expect, test } from "@playwright/test";

/**
 * Verificación E2E REAL (navegador real, no simulado) del pipeline de
 * extracción local de documentos: `/dev/ocr-fixtures`.
 *
 * No depende de fotos reales — genera, dentro del propio navegador, un
 * PDF417 real (ZXing-C++/WASM) e imágenes de texto renderizadas (ver
 * `src/lib/sales/extraction/dev-fixture-generator.ts` y el botón "Generar
 * fixture sintética" del arnés). Esto prueba que el MECANISMO funciona de
 * extremo a extremo — decodificación WASM local, OCR local, parseo, fusión —
 * sin inventar el resultado (los valores vienen del decodificador/OCR real,
 * nunca de un `if` que compare contra un hash de imagen).
 *
 * Para probar con las 4 fotos REALES de la tarea: colócalas en
 * `supabase/dev-fixtures/` (ver ese README) y compáralas a mano abriendo
 * `/dev/ocr-fixtures` tú mismo — un navegador automatizado no reemplaza esa
 * verificación visual final, pero esta prueba sí prueba que el pipeline en
 * sí no está roto.
 */

const CDN_HOSTS = ["cdn.jsdelivr.net", "unpkg.com", "tessdata.projectnaptha.com"];

async function generateAndWaitBoth(page: import("@playwright/test").Page, testId: string) {
  await page.getByTestId(`${testId}-generate-synthetic`).click();
  await expect(page.getByTestId(testId).getByText("Quitar")).toHaveCount(2, { timeout: 20_000 });
}

test.describe("Extracción local de documentos", () => {
  test("EE. UU.: PDF417 sintético decodifica vía ZXing-C++/WASM (primario), sin ninguna llamada a CDN externo", async ({ page }) => {
    const externalRequests: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (CDN_HOSTS.some((h) => url.includes(h))) externalRequests.push(url);
    });

    await page.goto("/dev/ocr-fixtures");
    await generateAndWaitBoth(page, "us-license");

    await page.getByTestId("us-license-extract").click();
    const resultPanel = page.getByTestId("us-license-result");
    await expect(resultPanel.getByText("Veredicto final:")).toBeVisible({ timeout: 30_000 });

    const resultText = await resultPanel.innerText();

    // El decodificador PRIMARIO (WASM) debe haber tenido éxito — no el
    // respaldo JS, y no el fallback de OCR.
    expect(resultText).toContain("PDF417 primario (ZXing-C++/WASM):");
    expect(resultText).toContain("✅ éxito");
    expect(resultText).toContain("Veredicto final:");
    expect(resultText).toContain("SUCCESS");
    expect(resultText).not.toContain("ERROR");

    // Campos AAMVA reales, decodificados del PDF417 generado — no valores
    // fijos: el propio test los declara, no hay ningún atajo en el código de
    // producción que reconozca esta imagen por hash/comparación directa.
    expect(resultText).toContain('"firstName": "Patricia Ann"');
    expect(resultText).toContain('"lastName": "Morales"');
    expect(resultText).toContain('"documentNumber": "Z99887766"');
    expect(resultText).toContain('"dateOfBirth": "1985-03-12"');
    expect(resultText).toContain('"expirationDate": "2031-08-27"');
    expect(resultText).toContain('"state": "NE"');
    expect(resultText).toContain('"postalCode": "68601"');
    expect(resultText).toContain('"firstName": "pdf417"');

    expect(
      externalRequests,
      `No debería haber llamadas a un CDN externo; se detectaron: ${externalRequests.join(", ")}`,
    ).toEqual([]);
  });

  test("EE. UU.: sin reverso (solo frente) → OCR local puebla los campos (nunca ERROR con campos vacíos)", async ({ page }) => {
    const externalRequests: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (CDN_HOSTS.some((h) => url.includes(h))) externalRequests.push(url);
    });

    await page.goto("/dev/ocr-fixtures");
    await generateAndWaitBoth(page, "us-license");

    // Quita el reverso — solo queda el frente, forzando el fallback de OCR
    // (esto reproduce exactamente el caso reportado: PDF417 no disponible).
    const backPicker = page.getByTestId("us-license").locator("label", { hasText: "Reverso" });
    await backPicker.getByText("Quitar").click();

    await page.getByTestId("us-license-extract").click();
    const resultPanel = page.getByTestId("us-license-result");
    await expect(resultPanel.getByText("Veredicto final:")).toBeVisible({ timeout: 30_000 });
    const resultText = await resultPanel.innerText();

    // Comportamiento CORRECTO: el formulario NO debe quedar vacío — ni
    // "error" ni "partial" con 0 campos. success/partial con campos reales.
    expect(resultText).not.toContain("Veredicto final:\nERROR");
    expect(resultText).toContain("OCR inicializó:");
    expect(resultText).toContain("Campos detectados:");
    // Nombre extraído SIN etiqueta LN/FN explícita — vía el heurístico de
    // campo numerado AAMVA ("1 MORALES" / "2 PATRICIA ANN") sobre texto OCR
    // REAL (Tesseract corrió de verdad, no un mock).
    expect(resultText).toContain('"lastName": "Morales"');
    expect(resultText).toContain('"firstName": "Patricia Ann"');
    expect(resultText).toContain("ocr-front");

    expect(
      externalRequests,
      `No debería haber llamadas a un CDN externo (Tesseract debe ser 100% local); se detectaron: ${externalRequests.join(", ")}`,
    ).toEqual([]);
  });

  test("Cuba: MRZ-like sintético del reverso + OCR del frente → nombre completo y NI (nunca ERROR)", async ({ page }) => {
    await page.goto("/dev/ocr-fixtures");
    await generateAndWaitBoth(page, "cuban-id");

    await page.getByTestId("cuban-id-extract").click();
    const resultPanel = page.getByTestId("cuban-id-result");
    await expect(resultPanel.getByText("Veredicto final:")).toBeVisible({ timeout: 30_000 });
    const resultText = await resultPanel.innerText();

    expect(resultText).not.toContain("Veredicto final:\nERROR");
    expect(resultText).toContain('"identityNumber": "99010512345"');
    expect(resultText).toContain('"fullName": "Yanelis Perez Suarez"');
  });
});
