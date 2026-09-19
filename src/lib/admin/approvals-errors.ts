/** Códigos de las acciones del Centro de Aprobaciones → mensaje simple. */
const MESSAGES: Record<string, string> = {
  NOT_AUTHENTICATED: "Tu sesión no es válida. Inicia sesión de nuevo.",
  NOT_ADMIN: "Solo un administrador puede realizar esta acción.",
  NOT_OWNER: "No tienes permiso sobre esta venta.",
  PROFILE_INACTIVE: "Tu cuenta no está activa.",
  REASON_REQUIRED: "Describe el motivo de la modificación (mínimo 4 caracteres).",
  REVIEW_NOTE_REQUIRED: "Indica el motivo del rechazo.",
  NO_CHANGES: "No hay cambios para enviar.",
  SALE_NOT_FOUND: "No encontramos esta venta.",
  NOT_CUBA: "Esta operación solo aplica a ventas de Cuba.",
  INVALID_STATUS: "Esta acción no aplica al estado actual de la venta.",
  SALE_STATUS_CHANGED: "El estado de la venta cambió — revisa la venta antes de continuar.",
  SALE_PAID_REQUIRES_ADMIN_CORRECTION: "Las ventas pagadas requieren una corrección administrativa.",
  REQUEST_ALREADY_PENDING: "Ya existe una solicitud de edición pendiente de aprobación para esta venta.",
  INVALID_CHANGE_PATH: "Uno de los campos enviados no es editable.",
  UNIT_NOT_IN_SALE: "Una de las unidades no pertenece a esta venta.",
  COMMISSION_LOCKED: "La comisión de esa unidad ya está incluida en una liquidación: su precio no puede cambiar.",
  UNIT_AGREED_PRICE_INVALID: "Escribe un precio de venta mayor que $0.",
  UNIT_PRICE_BELOW_FIXED_PRICE:
    "El precio de venta no puede ser inferior al precio fijo del producto. Para un descuento, un administrador debe ajustar el precio fijo en la ficha del producto.",
  UNIT_COMMISSION_CONFIG_MISSING:
    "El producto no tiene precio fijo de venta o comisión fija. Un administrador debe completarlos en la ficha del producto.",
  EXTRA_NOT_IN_SALE: "Uno de los extras no pertenece a esta venta.",
  REQUEST_CONFLICT: "La venta cambió desde que se solicitó la edición. Revísala nuevamente.",
  REQUEST_NOT_FOUND: "No encontramos esta solicitud.",
  APPLY_FAILED: "No se pudo aplicar la solicitud — revisa los datos de la venta.",
  SETTLEMENT_INCOMPLETE: "El cobro de esta venta todavía no está completo.",
  UNEXPECTED: "No se pudo completar la acción. Intenta de nuevo.",
};

export function approvalsErrorText(code: string | undefined, detail?: unknown): string {
  if (!code) return MESSAGES.UNEXPECTED;
  // APPLY_FAILED trae el resultado del motor: si fue una regla de precio, se explica.
  if (code === "APPLY_FAILED" && detail && typeof detail === "object") {
    const errors = (detail as { errors?: unknown }).errors;
    const known = Array.isArray(errors) ? errors.find((e) => typeof e === "string" && e in MESSAGES) : undefined;
    if (typeof known === "string") return MESSAGES[known];
  }
  return MESSAGES[code] ?? MESSAGES.UNEXPECTED;
}
