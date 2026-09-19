import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Activos de terceros autohospedados (copiados tal cual de node_modules
    // para que la extracción de documentos no dependa de un CDN en runtime;
    // ver public/tesseract/README.md y public/zxing/README.md). No son
    // código fuente del proyecto.
    "public/tesseract/**",
    "public/zxing/**",
  ]),
]);

export default eslintConfig;
