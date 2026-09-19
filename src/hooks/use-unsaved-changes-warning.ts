"use client";

import { useEffect } from "react";

/**
 * Advierte antes de cerrar/recargar la pestaña con cambios sin guardar.
 * (La intercepción de navegación interna en App Router se añadirá junto con
 * el autoguardado en la fase de backend.)
 */
export function useUnsavedChangesWarning(active: boolean) {
  useEffect(() => {
    if (!active) return;

    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [active]);
}
