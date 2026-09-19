/** Códigos de las acciones de liquidación semanal → mensaje simple. */
const MESSAGES: Record<string, string> = {
  NOT_AUTHENTICATED: "Tu sesión no es válida. Inicia sesión de nuevo.",
  NOT_ADMIN: "Solo un administrador puede realizar esta acción.",
  SELLER_NOT_FOUND: "No encontramos este vendedor.",
  NOT_FOUND: "No encontramos esta liquidación.",
  NOT_DRAFT: "Esta liquidación ya no está en borrador — no se puede refrescar.",
  INVALID_STATUS: "Esta liquidación no está en el estado requerido para esta acción.",
  WEEK_NOT_CLOSED: "Esta semana todavía está en curso. Podrás aprobarla cuando cierre (termina el domingo).",
  INVALID_TYPE: "Tipo de ajuste inválido.",
  INVALID_AMOUNT: "El monto del ajuste debe ser mayor a cero.",
  REASON_REQUIRED: "Escribe un motivo para el ajuste.",
  ALREADY_PAID: "Esta liquidación ya está pagada — no se pueden agregar más ajustes.",
  UNEXPECTED: "No se pudo completar la acción. Intenta de nuevo.",
};

export function liquidationActionErrorText(code: string | undefined): string {
  if (!code) return MESSAGES.UNEXPECTED;
  return MESSAGES[code] ?? MESSAGES.UNEXPECTED;
}
