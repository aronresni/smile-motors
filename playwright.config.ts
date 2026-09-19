import { defineConfig } from "@playwright/test";

/**
 * Verificación E2E REAL (navegador real, WASM/Canvas reales) del pipeline de
 * extracción local de documentos — ver `e2e/README.md`. Corre contra
 * `next dev` porque `/dev/ocr-fixtures` solo existe fuera de producción.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  webServer: {
    // `--webpack`: en equipos donde una política de control de aplicaciones
    // bloquea el binario nativo de SWC, Turbopack no arranca (solo WASM).
    command: "npx next dev --webpack -p 3000",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
