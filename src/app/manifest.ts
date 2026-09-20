import type { MetadataRoute } from "next";

/**
 * Manifiesto de aplicación web (se sirve en `/manifest.webmanifest`).
 *
 * Por qué existe: sin él, iPhone añade "a la pantalla de inicio" un simple
 * marcador y la app se abre DENTRO de Safari, con su barra de direcciones y
 * su barra inferior. Desde iOS 16.4 Safari usa este manifiesto para decidir
 * si el icono es una aplicación web, y `display: "standalone"` es lo que
 * quita el cromo del navegador.
 *
 * `start_url` y `scope` son del mismo origen (la raíz): si la app saliera de
 * su ámbito, iOS la devolvería a Safari.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Smile Motors",
    short_name: "Smile Motors",
    description: "Smile Motors — sistema de gestión del concesionario",
    lang: "es",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    // Orden de preferencia para los navegadores que lo soportan; iOS se
    // queda con `display`.
    display_override: ["standalone", "minimal-ui"],
    background_color: "#090909",
    theme_color: "#090909",
    orientation: "portrait-primary",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icon.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
