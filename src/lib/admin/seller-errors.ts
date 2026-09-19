/** Códigos de las acciones de administración de vendedores → mensaje simple. */
const MESSAGES: Record<string, string> = {
  NOT_AUTHENTICATED: "Tu sesión no es válida. Inicia sesión de nuevo.",
  NOT_ADMIN: "Solo un administrador puede realizar esta acción.",
  INVALID_INPUT: "Revisa los datos del vendedor.",
  SELLER_NOT_FOUND: "No encontramos a este vendedor.",
  NOT_A_SELLER: "Esta cuenta no es de un vendedor.",
  INVALID_STATUS: "Esta acción no aplica al estado actual de la cuenta.",
  INVITATION_NOT_FOUND: "No encontramos una invitación pendiente para este vendedor.",
  EMAIL_ALREADY_INVITED: "Ya existe una cuenta con ese correo.",
  EMAIL_ALREADY_REGISTERED:
    "Ya hay una cuenta activa con ese correo. Si perdió el acceso, usa las acciones de su ficha.",
  INVITE_FAILED: "No se pudo generar el enlace de invitación. Intenta de nuevo.",
  RECORD_FAILED:
    "La cuenta se creó, pero no se pudo registrar la invitación. Contacta soporte técnico.",
  UNEXPECTED: "No se pudo completar la acción. Intenta de nuevo.",
};

export function sellerActionErrorText(code: string | undefined): string {
  if (!code) return MESSAGES.UNEXPECTED;
  return MESSAGES[code] ?? MESSAGES.UNEXPECTED;
}
