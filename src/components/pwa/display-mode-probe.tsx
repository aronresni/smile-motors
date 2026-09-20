"use client";

import { useEffect } from "react";

/**
 * Diagnóstico del modo de presentación, sin interfaz visible.
 *
 * Deja dos rastros para poder comprobar desde el propio iPhone si la app se
 * abrió como aplicación web o dentro de Safari:
 *  · `document.documentElement.dataset.displayMode` → "standalone" | "browser"
 *    (visible en el inspector y utilizable desde CSS: `html[data-display-mode]`),
 *  · una línea en la consola.
 *
 * `navigator.standalone` es lo que iOS ha usado siempre; `display-mode:
 * standalone` es el estándar (Safari lo soporta desde 16.4). Se comprueban
 * los dos.
 */
export function DisplayModeProbe() {
  useEffect(() => {
    const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone;
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches || iosStandalone === true;
    document.documentElement.dataset.displayMode = standalone ? "standalone" : "browser";
    console.info(
      `[Smile Motors] display-mode=${standalone ? "standalone" : "browser"} · navigator.standalone=${String(iosStandalone)}`,
    );
  }, []);

  return null;
}
