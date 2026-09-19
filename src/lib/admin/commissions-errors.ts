/** Códigos de las acciones de precio fijo / comisión fija → mensaje simple. */
const MESSAGES: Record<string, string> = {
  NOT_AUTHENTICATED: "Tu sesión no es válida. Inicia sesión de nuevo.",
  NOT_ADMIN: "Solo un administrador puede realizar esta acción.",
  FIXED_PRICE_REQUIRED: "Completa el precio fijo de venta.",
  FIXED_PRICE_INVALID: "El precio fijo de venta debe ser un importe mayor que $0.",
  FIXED_COMMISSION_REQUIRED: "Completa la comisión fija.",
  FIXED_COMMISSION_INVALID: "La comisión fija debe ser un importe mayor que $0.",
  FIXED_COMMISSION_TOO_HIGH: "La comisión fija debe ser menor que el precio fijo de venta.",
  INVALID_INPUT: "Revisa el precio fijo de venta y la comisión fija: deben ser importes mayores que $0.",
  PRODUCT_NOT_FOUND: "No encontramos este producto.",
  UNEXPECTED: "No se pudo completar la acción. Intenta de nuevo.",
};

export function commissionActionErrorText(code: string | undefined): string {
  if (!code) return MESSAGES.UNEXPECTED;
  return MESSAGES[code] ?? MESSAGES.UNEXPECTED;
}
