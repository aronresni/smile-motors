/** Códigos de las acciones de administración de vendedores → mensaje simple. */
const MESSAGES: Record<string, string> = {
  NOT_AUTHENTICATED: "Tu sesión no es válida. Inicia sesión de nuevo.",
  NOT_ADMIN: "Solo un administrador puede realizar esta acción.",
  INVALID_INPUT: "Revisa los datos del vendedor.",
  SELLER_NOT_FOUND: "No encontramos a este vendedor.",
  NOT_A_SELLER: "Esta cuenta no es de un vendedor.",
  INVALID_STATUS: "Esta acción no aplica al estado actual de la cuenta.",
  INVITATION_NOT_FOUND: "No encontramos una invitación pendiente para este vendedor.",
  RATE_LIMITED:
    "Se alcanzó el límite de envío de correos de Supabase. Espera unos minutos o configura un proveedor SMTP propio.",
  EMAIL_ALREADY_INVITED: "Ya existe una cuenta con ese correo.",
  INVITE_FAILED: "No se pudo enviar la invitación. Intenta de nuevo.",
  RECORD_FAILED: "El correo se envió, pero no se pudo registrar la invitación. Contacta soporte técnico.",
  UNEXPECTED: "No se pudo completar la acción. Intenta de nuevo.",
};

export function sellerActionErrorText(code: string | undefined): string {
  if (!code) return MESSAGES.UNEXPECTED;
  return MESSAGES[code] ?? MESSAGES.UNEXPECTED;
}
