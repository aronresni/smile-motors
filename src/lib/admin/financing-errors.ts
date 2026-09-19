/** Códigos de las acciones de administración de financieras → mensaje simple. */
const MESSAGES: Record<string, string> = {
  NOT_AUTHENTICATED: "Tu sesión no es válida. Inicia sesión de nuevo.",
  NOT_ADMIN: "Solo un administrador puede realizar esta acción.",
  INVALID_INPUT: "Revisa los datos de la financiera.",
  INVALID_TYPE: "Tipo de método de pago inválido.",
  INVALID_FEE_STRATEGY: "Estrategia de comisión inválida.",
  CODE_ALREADY_EXISTS: "Ya existe una financiera con ese código interno.",
  PROVIDER_NOT_FOUND: "No encontramos esta financiera.",
  PLAN_NOT_FOUND: "No encontramos este plan.",
  UNEXPECTED: "No se pudo completar la acción. Intenta de nuevo.",
};

export function financingActionErrorText(code: string | undefined): string {
  if (!code) return MESSAGES.UNEXPECTED;
  return MESSAGES[code] ?? MESSAGES.UNEXPECTED;
}
