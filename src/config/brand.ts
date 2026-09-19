/**
 * Identidad OFICIAL del concesionario — única fuente de verdad de marca.
 *
 * El logo es el asset entregado por el concesionario (PNG 1254×1254, RGBA con
 * fondo transparente). NUNCA se redibuja ni se reinterpreta: se usa el archivo
 * real, siempre con relación de aspecto 1:1 (`object-contain`), y sobre
 * superficies oscuras (las letras "MOTORS" son blancas).
 */
export const BRAND = {
  name: "SMILE MOTORS",
  displayName: "Smile Motors",
  logo: {
    src: "/brand/smile-motors-logo.png",
    width: 1254,
    height: 1254,
    alt: "Smile Motors",
  },
} as const;
