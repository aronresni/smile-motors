import path from "node:path";

/**
 * Credenciales de las cuentas de prueba E2E (`e2e-*@motods.test`).
 *
 * La contraseña vive SOLO en `.env.local` (`E2E_PASSWORD`, ignorado por git):
 * nunca en el repositorio. Esas cuentas existen en la base real (algunas son
 * administradoras), así que una contraseña publicada sería un acceso real.
 */
try {
  process.loadEnvFile(path.resolve(__dirname, "../.env.local"));
} catch {
  /* sin .env.local: el error de abajo lo explica */
}

const value = process.env.E2E_PASSWORD;
if (!value) {
  throw new Error("Falta E2E_PASSWORD en .env.local (contraseña de las cuentas de prueba E2E).");
}

export const E2E_PASSWORD: string = value;
