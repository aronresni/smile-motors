/**
 * Provincias de Cuba — datos de referencia de frontend.
 * TODO(backend): si se centraliza en base de datos, sustituir esta constante.
 * El municipio se mantiene como texto libre hasta definir su catálogo.
 */
export const CUBA_PROVINCES = [
  "Pinar del Río",
  "Artemisa",
  "La Habana",
  "Mayabeque",
  "Matanzas",
  "Cienfuegos",
  "Villa Clara",
  "Sancti Spíritus",
  "Ciego de Ávila",
  "Camagüey",
  "Las Tunas",
  "Holguín",
  "Granma",
  "Santiago de Cuba",
  "Guantánamo",
  "Isla de la Juventud",
] as const;

export type CubaProvince = (typeof CUBA_PROVINCES)[number];

export const CUBA_PHONE_PREFIX = "+53";
