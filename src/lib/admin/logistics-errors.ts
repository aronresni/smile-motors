const MESSAGES: Record<string, string> = {
  NOT_AUTHENTICATED: "Tu sesión no es válida. Inicia sesión de nuevo.",
  NOT_ADMIN: "Solo un administrador puede realizar esta acción.",
  LOGISTICS_NOT_FOUND: "No encontramos el registro logístico de esta unidad.",
  INVALID_TRANSITION: "Ese cambio de estado no es válido desde el estado actual. Usa una corrección si necesitas saltar pasos.",
  INVALID_STATUS: "Estado logístico inválido.",
  REASON_REQUIRED: "Escribe un motivo.",
  SAME_STATUS: "La unidad ya está en ese estado.",
  UNEXPECTED: "No se pudo completar la acción. Intenta de nuevo.",
};

export function logisticsActionErrorText(code: string | undefined): string {
  if (!code) return MESSAGES.UNEXPECTED;
  return MESSAGES[code] ?? MESSAGES.UNEXPECTED;
}
