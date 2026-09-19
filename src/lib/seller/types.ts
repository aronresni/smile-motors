/**
 * Modelo de datos del panel del vendedor.
 *
 * Interfaces de frontend: describen la forma que tendrán las métricas cuando
 * existan las tablas relacionales. Hoy `getSellerDashboardData` las devuelve
 * en cero / vacías, pero las firmas ya son las definitivas.
 */

export type TrendDirection = "up" | "down" | "neutral";

export type KpiId = "facturado" | "unidades" | "comisiones";

export interface KpiMetric {
  id: KpiId;
  label: string;
  /** Valor numérico crudo del período seleccionado. */
  value: number;
  /** Cómo formatear `value` en la UI. */
  format: "money" | "units";
  /** Mismo indicador en el período anterior equivalente. */
  previousValue: number;
  /** Variación porcentual vs período anterior. 0 si no hay base. */
  deltaPct: number;
  trend: TrendDirection;
  /** La métrica no tiene backend autoritativo aún (p. ej. comisiones). */
  unavailable?: boolean;
  /** Texto alternativo para la variación (p. ej. "nuevo" cuando no hay base). */
  deltaLabel?: string;
}

/** Categorías de actividad de ventas (telemetría). */
export type SalesRegion = "cuba" | "usa" | "local";

export interface SalesActivityBucket {
  /** Etiqueta del intervalo (hora, día, semana o mes según el período). */
  label: string;
  cuba: number;
  usa: number;
  local: number;
}

export interface SalesActivitySeries {
  buckets: SalesActivityBucket[];
  totalUnits: number;
}

export interface BonusProgress {
  /** El motor de bonos aún no está configurado. */
  configured?: boolean;
  currentUnits: number;
  targetUnits: number;
  currentBonus: number;
  nextBonus: number;
  remainingUnits: number;
  marketingBonus: number;
  marketingBonusPerUnit: number;
  marketingBonusLimit: number;
}

export interface LiquidationWeek {
  weekStartISO: string;
  /** Etiqueta corta, p. ej. "09/01". */
  label: string;
  commission: number;
  bonus: number;
  total: number;
}

export interface TopModel {
  name: string;
  units: number;
  /** Participación 0..1 sobre el total de unidades del vendedor. */
  share: number;
  isOther?: boolean;
}

export interface SellerDashboardData {
  kpis: KpiMetric[];
  salesActivity: SalesActivitySeries;
  bonus: BonusProgress;
  liquidations: LiquidationWeek[];
  topModels: TopModel[];
  /** ISO de generación, para depurar y para revalidación futura. */
  generatedAt: string;
}
