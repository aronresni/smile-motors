import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { E2E_PASSWORD } from "./credentials";

/**
 * Regresión del fallo reportado en iPhone/Safari: al elegir una foto de la
 * GALERÍA y pulsar "Done", la imagen "desaparecía" y el editor de recorte
 * nunca se abría.
 *
 * Causa: la foto se convertía en un data URL de tamaño completo y se
 * decodificaba varias veces a 12–48 MP. Estas pruebas fijan el
 * comportamiento nuevo: la imagen se reduce ANTES de editarla, el editor
 * siempre se abre, y cuando de verdad no se puede abrir el archivo el
 * vendedor recibe un mensaje accionable en vez de quedarse en "Procesando".
 */

const TEST_EMAIL = "e2e-seller@motods.test";

/** Tope de la imagen de trabajo (`src/lib/sales/prepare-image-file.ts`). */
const MAX_WORKING_SIDE = 2600;

test.beforeAll(() => {
  execFileSync(
    "node",
    [
      "--env-file=.env.local",
      "supabase/scripts/create-user.mjs", "--sandbox",
      "--email", TEST_EMAIL,
      "--password", E2E_PASSWORD,
      "--role", "seller",
      "--name", "Vendedor E2E",
    ],
    { cwd: path.resolve(__dirname, ".."), stdio: "inherit" },
  );
});

async function login(page: Page) {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(TEST_EMAIL);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.getByRole("button", { name: /iniciar sesión/i }).click();
  await page.waitForURL(/\/seller/, { timeout: 15_000 });
}

/** Foto sintética de cuatro cuadrantes (rojo · verde / azul · amarillo),
 * como JPEG — el mismo tipo de archivo que entrega la galería del teléfono. */
async function makePhoto(page: Page, width: number, height: number): Promise<Buffer> {
  const dataUrl = await page.evaluate(
    ([w, h]) => {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      const quadrants: [string, number, number][] = [
        ["#e11d48", 0, 0],
        ["#16a34a", w / 2, 0],
        ["#2563eb", 0, h / 2],
        ["#facc15", w / 2, h / 2],
      ];
      for (const [color, x, y] of quadrants) {
        ctx.fillStyle = color;
        ctx.fillRect(x, y, w / 2, h / 2);
      }
      return canvas.toDataURL("image/jpeg", 0.92);
    },
    [width, height] as const,
  );
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

interface Measured {
  width: number;
  height: number;
  bytes: number;
  /** Color RGB en cada punto relativo pedido. */
  colors: [number, number, number][];
}

/** Mide la imagen guardada (tamaño real y colores), decodificándola en el
 * propio navegador. */
async function measure(
  page: Page,
  src: string,
  points: [number, number][],
): Promise<Measured> {
  return page.evaluate(
    async ({ src, points }) => {
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = src;
      });
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const colors = points.map(([rx, ry]) => {
        const x = Math.min(canvas.width - 1, Math.round(rx * canvas.width));
        const y = Math.min(canvas.height - 1, Math.round(ry * canvas.height));
        const d = ctx.getImageData(x, y, 1, 1).data;
        return [d[0], d[1], d[2]] as [number, number, number];
      });
      return {
        width: img.naturalWidth,
        height: img.naturalHeight,
        bytes: Math.round(((src.length - src.indexOf(",") - 1) * 3) / 4),
        colors,
      };
    },
    { src, points },
  );
}

function expectColor(actual: [number, number, number], expected: [number, number, number]) {
  for (let i = 0; i < 3; i++) {
    expect(Math.abs(actual[i] - expected[i]),
      `canal ${i}: ${actual.join(",")} ≠ ${expected.join(",")}`).toBeLessThan(40);
  }
}

const RED: [number, number, number] = [225, 29, 72];
const GREEN: [number, number, number] = [22, 163, 74];
const BLUE: [number, number, number] = [37, 99, 235];
const YELLOW: [number, number, number] = [250, 204, 21];
/** Esquinas: arriba-izq., arriba-der., abajo-izq., abajo-der. */
const CORNERS: [number, number][] = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];

async function openNewSale(page: Page): Promise<{ buyer: Locator; frontInput: Locator }> {
  await page.goto("/seller/ventas/nueva/cuba");
  const buyer = page.locator("#section-buyer");
  await expect(buyer).toBeVisible({ timeout: 15_000 });
  return { buyer, frontInput: buyer.locator("input[type='file']").first() };
}

const savedImage = (page: Page) => page.getByAltText("ID del comprador — frente");

test.describe("Foto de la galería (regresión iPhone)", () => {
  test("una foto de 17 MP abre el editor, se guarda reducida y nunca se queda en 'Procesando imagen…'", async ({
    page,
  }) => {
    await login(page);
    const { buyer, frontInput } = await openNewSale(page);
    // Tamaño típico de la galería de un iPhone (4800×3600 = 17,3 MP).
    const photo = await makePhoto(page, 4800, 3600);

    await frontInput.setInputFiles({ name: "IMG_4821.JPG", mimeType: "image/jpeg", buffer: photo });

    // El fallo reportado: el editor NO aparecía.
    await expect(page.getByText("Ajustar documento")).toBeVisible({ timeout: 30_000 });

    const save = page.getByRole("button", { name: "Guardar", exact: true });
    await save.click();
    await expect(save).toBeHidden({ timeout: 20_000 });
    // Queda la foto, no un "Procesando imagen…" eterno ni un error.
    await expect(buyer.getByText("Procesando imagen…")).toBeHidden();
    await expect(buyer.getByText(/No pudimos abrir|no pudo procesar|supera/)).toBeHidden();

    const src = await savedImage(page).getAttribute("src");
    expect(src?.startsWith("data:image/jpeg")).toBe(true);
    const saved = await measure(page, src!, CORNERS);

    // Se redujo a la imagen de trabajo (y con ella, la memoria que consume
    // el teléfono) conservando el encuadre completo.
    expect(Math.max(saved.width, saved.height)).toBeLessThanOrEqual(MAX_WORKING_SIDE);
    expect(Math.abs(saved.width / saved.height - 4800 / 3600)).toBeLessThan(0.02);
    expect(saved.bytes).toBeLessThan(3 * 1024 * 1024);
    for (const [i, expected] of [RED, GREEN, BLUE, YELLOW].entries()) {
      expectColor(saved.colors[i], expected);
    }
  });

  test("el recorte respeta la imagen y la rotación", async ({ page }) => {
    await login(page);
    const { buyer, frontInput } = await openNewSale(page);
    const photo = await makePhoto(page, 1200, 800);
    const save = page.getByRole("button", { name: "Guardar", exact: true });

    // "Usar imagen completa": sale tal cual, sin perder nada ni desplazarse.
    await frontInput.setInputFiles({ name: "IMG_0001.JPG", mimeType: "image/jpeg", buffer: photo });
    await expect(page.getByText("Ajustar documento")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Usar imagen completa" }).click();
    await expect(save).toBeHidden({ timeout: 20_000 });

    let saved = await measure(page, (await savedImage(page).getAttribute("src"))!, CORNERS);
    expect(saved.width).toBe(1200);
    expect(saved.height).toBe(800);
    for (const [i, expected] of [RED, GREEN, BLUE, YELLOW].entries()) {
      expectColor(saved.colors[i], expected);
    }

    // Rotar a la derecha 90°: el cuadrante de abajo-izq. (azul) pasa a
    // arriba-izq., y la imagen queda vertical.
    await buyer.getByRole("button", { name: "Reajustar" }).click();
    await expect(page.getByText("Ajustar documento")).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: /Rotar derecha/ }).click();
    await page.getByRole("button", { name: "Usar imagen completa" }).click();
    await expect(save).toBeHidden({ timeout: 20_000 });

    saved = await measure(page, (await savedImage(page).getAttribute("src"))!, CORNERS);
    expect(saved.width).toBe(800);
    expect(saved.height).toBe(1200);
    for (const [i, expected] of [BLUE, RED, YELLOW, GREEN].entries()) {
      expectColor(saved.colors[i], expected);
    }
  });

  test("cancelar un 'Reemplazar' conserva la foto anterior y 'Reajustar' sigue funcionando", async ({
    page,
  }) => {
    await login(page);
    const { buyer, frontInput } = await openNewSale(page);
    const save = page.getByRole("button", { name: "Guardar", exact: true });

    await frontInput.setInputFiles({
      name: "IMG_0010.JPG",
      mimeType: "image/jpeg",
      buffer: await makePhoto(page, 1200, 800),
    });
    await expect(page.getByText("Ajustar documento")).toBeVisible({ timeout: 30_000 });
    await save.click();
    await expect(save).toBeHidden({ timeout: 20_000 });

    // Se elige otra foto (vertical) y se CANCELA el recorte.
    await frontInput.setInputFiles({
      name: "IMG_0011.JPG",
      mimeType: "image/jpeg",
      buffer: await makePhoto(page, 600, 1200),
    });
    await expect(page.getByText("Ajustar documento")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Cancelar" }).click();
    await expect(page.getByText("Ajustar documento")).toBeHidden({ timeout: 20_000 });

    // Sigue la primera foto…
    let saved = await measure(page, (await savedImage(page).getAttribute("src"))!, CORNERS);
    expect(saved.width).toBe(1200);
    expect(saved.height).toBe(800);

    // …y "Reajustar" abre esa misma imagen (no una liberada ni la descartada).
    await buyer.getByRole("button", { name: "Reajustar" }).click();
    await expect(page.getByText("Ajustar documento")).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Usar imagen completa" }).click();
    await expect(save).toBeHidden({ timeout: 20_000 });

    saved = await measure(page, (await savedImage(page).getAttribute("src"))!, CORNERS);
    expect(saved.width).toBe(1200);
    expect(saved.height).toBe(800);
    for (const [i, expected] of [RED, GREEN, BLUE, YELLOW].entries()) {
      expectColor(saved.colors[i], expected);
    }
  });

  test("una foto sin tipo MIME (iCloud / Archivos) se acepta igual", async ({ page }) => {
    await login(page);
    const { buyer, frontInput } = await openNewSale(page);
    const photo = await makePhoto(page, 1600, 1200);

    // iOS entrega algunas fotos sin `type`; antes se rechazaban de entrada.
    await frontInput.setInputFiles({ name: "IMG_0002.JPG", mimeType: "", buffer: photo });

    await expect(page.getByText("Ajustar documento")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(savedImage(page)).toBeVisible({ timeout: 20_000 });
    await expect(buyer.getByText(/No pudimos abrir|Selecciona un archivo/)).toBeHidden();
  });

  test("una foto que el teléfono no llega a entregar (iCloud sin descargar) avisa en vez de desaparecer", async ({
    page,
  }) => {
    await login(page);
    const { buyer, frontInput } = await openNewSale(page);

    await frontInput.setInputFiles({
      name: "IMG_0005.JPG",
      mimeType: "image/jpeg",
      buffer: Buffer.alloc(0),
    });

    await expect(buyer.getByText(/No recibimos la foto/)).toBeVisible({ timeout: 15_000 });
    await expect(buyer.getByText("Procesando imagen…")).toBeHidden();
  });

  test("un archivo que el navegador no puede abrir da un mensaje accionable, no un cuelgue", async ({
    page,
  }) => {
    await login(page);
    const { buyer, frontInput } = await openNewSale(page);

    // Una foto de iCloud sin descargar, o un HEIC en un navegador que no lo
    // soporta, llegan como bytes que no se pueden decodificar.
    await frontInput.setInputFiles({
      name: "IMG_0003.HEIC",
      mimeType: "image/heic",
      buffer: Buffer.from("no-es-una-imagen-real"),
    });

    await expect(buyer.getByText(/No pudimos abrir esta foto/)).toBeVisible({ timeout: 30_000 });
    await expect(buyer.getByText("Procesando imagen…")).toBeHidden();
    await expect(page.getByText("Ajustar documento")).toBeHidden();
    // Sigue pudiendo reintentar por cualquiera de los dos caminos.
    await expect(buyer.getByRole("button", { name: /Elegir foto de la galería/ }).first()).toBeVisible();
    await expect(buyer.getByRole("button", { name: "Tomar foto con la cámara" }).first()).toBeVisible();

    // Y una foto válida después del fallo funciona con normalidad.
    await frontInput.setInputFiles({
      name: "IMG_0004.JPG",
      mimeType: "image/jpeg",
      buffer: await makePhoto(page, 1200, 800),
    });
    await expect(page.getByText("Ajustar documento")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(savedImage(page)).toBeVisible({ timeout: 20_000 });
    await expect(buyer.getByText(/No pudimos abrir esta foto/)).toBeHidden();
  });
});
