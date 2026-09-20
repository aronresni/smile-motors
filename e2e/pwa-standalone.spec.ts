import { expect, test, type Page } from "@playwright/test";

/**
 * Aplicación web instalable (iPhone: "Añadir a pantalla de inicio").
 *
 * Regresión de un fallo real: la app se instalaba como simple marcador y el
 * icono abría Safari con su barra de direcciones, porque el HTML no traía
 * manifiesto ni las metas de Apple y `/manifest.webmanifest` daba 404.
 *
 * Lo que fija esta prueba es justo lo que iOS mira para decidir si el icono
 * es una aplicación web o un marcador.
 */

/** Etiquetas del `<head>` renderizado (sin depender del HTML como texto). */
async function head(page: Page) {
  return page.evaluate(() => ({
    manifests: [...document.querySelectorAll('link[rel="manifest"]')].map((l) =>
      l.getAttribute("href"),
    ),
    appleCapable: document
      .querySelector('meta[name="apple-mobile-web-app-capable"]')
      ?.getAttribute("content"),
    webAppCapable: document
      .querySelector('meta[name="mobile-web-app-capable"]')
      ?.getAttribute("content"),
    appleTitle: document
      .querySelector('meta[name="apple-mobile-web-app-title"]')
      ?.getAttribute("content"),
    statusBar: document
      .querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')
      ?.getAttribute("content"),
    viewport: document.querySelector('meta[name="viewport"]')?.getAttribute("content"),
    themeColor: document.querySelector('meta[name="theme-color"]')?.getAttribute("content"),
    appleTouchIcons: [...document.querySelectorAll('link[rel="apple-touch-icon"]')].map((l) =>
      l.getAttribute("href"),
    ),
  }));
}

test.describe("Aplicación instalable (pantalla de inicio del iPhone)", () => {
  test("el HTML declara el manifiesto y las metas de Apple, sin duplicados", async ({ page }) => {
    await page.goto("/login");
    const tags = await head(page);

    // Una sola etiqueta de manifiesto: la pone Next por `app/manifest.ts`.
    expect(tags.manifests).toEqual(["/manifest.webmanifest"]);
    // Next emite el estándar; iOS anterior a Safari 17.4 necesita el de Apple.
    expect(tags.appleCapable).toBe("yes");
    expect(tags.webAppCapable).toBe("yes");
    expect(tags.appleTitle).toBe("Smile Motors");
    expect(tags.statusBar).toBe("black-translucent");
    // `viewport-fit=cover` + área segura: el contenido llega a los bordes sin
    // quedar debajo de la hora ni del indicador de inicio.
    expect(tags.viewport).toContain("width=device-width");
    expect(tags.viewport).toContain("initial-scale=1");
    expect(tags.viewport).toContain("viewport-fit=cover");
    expect(tags.themeColor).toBe("#090909");
    expect(tags.appleTouchIcons).toHaveLength(1);
  });

  test("el manifiesto se sirve como tal y pide modo standalone", async ({ page, baseURL }) => {
    const res = await page.request.get("/manifest.webmanifest");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/manifest+json");

    const m = await res.json();
    expect(m.display).toBe("standalone"); // sin esto, el icono abre Safari
    expect(m.id).toBe("/");
    expect(m.start_url).toBe("/");
    expect(m.scope).toBe("/");
    expect(m.name).toBe("Smile Motors");
    expect(m.short_name).toBe("Smile Motors");
    expect(m.theme_color).toBe("#090909");
    expect(m.background_color).toBe("#090909");
    expect(m.orientation).toBe("portrait-primary");

    // El arranque tiene que caer dentro del ámbito y del mismo origen.
    const origin = new URL(baseURL!).origin;
    expect(new URL(m.start_url, origin).href.startsWith(new URL(m.scope, origin).href)).toBe(true);

    // Los tamaños que piden los instaladores, y todos accesibles.
    expect(m.icons.map((i: { sizes: string }) => i.sizes)).toEqual(
      expect.arrayContaining(["192x192", "512x512"]),
    );
    for (const icon of m.icons as { src: string }[]) {
      const img = await page.request.get(icon.src);
      expect(img.status(), `icono ${icon.src}`).toBe(200);
      expect(img.headers()["content-type"]).toContain("image/png");
    }
  });

  test("el arranque no sale del origen (salir devolvería la app a Safari)", async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    for (const path of ["/", "/seller", "/admin"]) {
      const res = await page.request.get(path, { maxRedirects: 0 });
      const location = res.headers()["location"];
      if (location) {
        expect(new URL(location, origin).origin, `redirección de ${path}`).toBe(origin);
      }
    }
    await page.goto("/");
    await page.waitForURL(/\/login/);
    expect(new URL(page.url()).origin).toBe(origin);
  });

  test("la app detecta si se abrió como aplicación o dentro del navegador", async ({ browser }) => {
    // En un navegador normal: "browser".
    const plain = await browser.newContext();
    const plainPage = await plain.newPage();
    await plainPage.goto("/login");
    await expect(plainPage.locator("html")).toHaveAttribute("data-display-mode", "browser");
    await plain.close();

    // Como lo ve iOS al abrirla desde la pantalla de inicio.
    const installed = await browser.newContext();
    await installed.addInitScript(() => {
      Object.defineProperty(window.navigator, "standalone", { value: true, configurable: true });
    });
    const installedPage = await installed.newPage();
    await installedPage.goto("/login");
    await expect(installedPage.locator("html")).toHaveAttribute("data-display-mode", "standalone");
    await installed.close();
  });
});
