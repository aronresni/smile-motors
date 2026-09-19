"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Si el navegador restaura la página desde el back-forward cache (botón "atrás"
 * después de cerrar sesión), forzamos revalidación en el servidor. Junto con las
 * cabeceras `Cache-Control: no-store` del proxy, evita ver páginas protegidas
 * de una sesión ya terminada.
 */
export function BfcacheGuard() {
  const router = useRouter();

  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) router.refresh();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [router]);

  return null;
}
