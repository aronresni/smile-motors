/**
 * Reglas de bono por defecto — configuración TEMPORAL.
 *
 * TODO(backend): estas reglas deben venir de configuración de negocio
 * (tabla `bonus_config` o similar), no vivir en el frontend. Este archivo
 * solo aísla los valores para que el widget de progreso tenga una forma
 * concreta que consumir mientras no exista el motor de bonos.
 *
 * Ninguna de estas cifras es una métrica del vendedor: son objetivos/reglas.
 * Las métricas reales (unidades logradas, bono actual) llegan en 0 hasta que
 * haya ventas registradas.
 */
export interface BonusRules {
  /** Unidades necesarias para alcanzar el próximo tramo de bono. */
  targetUnits: number;
  /** Importe del próximo bono de ventas al llegar a `targetUnits`. */
  nextBonus: number;
  /** Bono de marketing por unidad vendida. */
  marketingBonusPerUnit: number;
  /** Tope de unidades que acumulan bono de marketing. */
  marketingBonusLimit: number;
}

export const DEFAULT_BONUS_RULES: BonusRules = {
  targetUnits: 4,
  nextBonus: 250,
  marketingBonusPerUnit: 50,
  marketingBonusLimit: 4,
};
