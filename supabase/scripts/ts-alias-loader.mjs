/**
 * Resolutor mínimo de módulos para poder importar directamente los módulos
 * TS del proyecto (que usan el alias `@/` → `./src/`) desde Node con
 * `--experimental-strip-types`, sin bundler. Solo para scripts de
 * verificación locales; no forma parte de la app ni de su build.
 *
 * Uso:
 *   npm run test:ocr-parsers
 *   (o: node --experimental-strip-types --import ./supabase/scripts/ts-alias-loader.mjs \
 *       supabase/scripts/test-id-extraction-parsers.ts)
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./ts-alias-hooks.mjs", pathToFileURL(`${import.meta.dirname}/`));
