/** Hooks de resolución del alias `@/` para `ts-alias-loader.mjs`. Ver ahí. */
import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

const SRC_ROOT = path.resolve("src");

function resolveWithExtension(basePath) {
  for (const ext of [".ts", ".tsx", ".mts"]) {
    if (fs.existsSync(basePath + ext)) return basePath + ext;
  }
  if (fs.existsSync(basePath) ) return basePath;
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const mapped = path.join(SRC_ROOT, specifier.slice(2));
    const found = resolveWithExtension(mapped);
    if (found) {
      return { url: pathToFileURL(found).href, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}
