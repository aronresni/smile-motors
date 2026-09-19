/**
 * Configuración TEMPORAL del concesionario.
 *
 * TODO(admin): esto debe pasar a ser configurable por administración (tabla
 * `dealers` / `settings` y resolución por vendedor). Mientras tanto, este
 * objeto centraliza el dato para que el cambio sea de un solo punto — NO
 * repartir nombre/dirección del negocio por los componentes.
 *
 * Marca oficial: SMILE MOTORS (logo en `public/brand/smile-motors-logo.png`,
 * ver `src/config/brand.ts`). La dirección sigue siendo un valor temporal.
 */
export interface DealerInfo {
  name: string;
  shortName: string;
  /** Dirección para el mensaje de envío a Cuba. */
  addressLine: string;
  /**
   * Zona horaria de negocio (IANA), única fuente de verdad en el frontend
   * para formatear fechas/horas relacionadas con Liquidación Semanal
   * (`closesAt`, etc.) — el lado servidor tiene su propia fuente de verdad
   * equivalente en `_dealer_timezone()` (SQL). Cambiar AMBOS puntos juntos
   * si el negocio se traslada de zona horaria.
   */
  timezone: string;
}

export const DEALER: DealerInfo = {
  name: "Smile Motors",
  shortName: "Smile",
  addressLine: "Miami, FL",
  timezone: "America/New_York",
};
