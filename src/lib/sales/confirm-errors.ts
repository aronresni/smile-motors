/** Mapea los códigos de `confirm_cuba_sale` a mensajes en español + sección. */

export const CONFIRM_ERROR_MESSAGES: Record<string, string> = {
  NOT_AUTHENTICATED: "Tu sesión no es válida. Inicia sesión de nuevo.",
  PROFILE_INACTIVE: "Tu cuenta no está habilitada.",
  SALE_NOT_FOUND: "No encontramos esta venta.",
  NOT_OWNER: "Esta venta no te pertenece.",
  NOT_ADMIN: "Solo un administrador puede realizar esta acción.",
  NOT_CUBA: "Esta operación no es de tipo Cuba.",
  INVALID_STATUS: "Esta venta ya no está en el estado esperado.",
  VALIDATION_FAILED: "Faltan datos para confirmar la venta.",
  REASON_REQUIRED: "Escribe un motivo (mínimo 4 caracteres).",
  SETTLEMENT_INCOMPLETE:
    "Todavía falta dinero por cobrar; no se puede marcar como pagada.",
  UNEXPECTED: "No pudimos completar la acción. Intenta de nuevo.",

  BUYER_MISSING: "Falta la información del comprador.",
  BUYER_FIRST_NAME_MISSING: "Falta el nombre del comprador.",
  BUYER_LAST_NAME_MISSING: "Faltan los apellidos del comprador.",
  BUYER_DOCUMENT_NUMBER_MISSING: "Falta el N.º de ID / licencia del comprador.",
  BUYER_PHONE_MISSING: "Falta el teléfono del comprador.",
  BUYER_DOCUMENT_FRONT_MISSING: "Falta el documento frontal del comprador.",
  BUYER_DOCUMENT_BACK_MISSING: "Falta el documento reverso del comprador.",

  NO_SALE_UNITS: "Agrega al menos una unidad.",
  UNIT_PRODUCT_MISSING: "Hay una unidad sin producto seleccionado.",
  UNIT_PRODUCT_INACTIVE: "Un producto seleccionado ya no está disponible.",
  UNIT_VARIANT_MISMATCH: "Una variante no corresponde a su producto.",
  UNIT_AGREED_PRICE_INVALID: "Hay una unidad con precio de venta en 0.",
  UNIT_PRICE_BELOW_FIXED_PRICE:
    "El precio de venta no puede ser inferior al precio fijo del producto. Para un descuento, un administrador debe ajustar el precio fijo en la ficha del producto.",
  UNIT_COMMISSION_CONFIG_MISSING:
    "Un producto de esta venta no tiene precio fijo de venta o comisión fija. Un administrador debe completarlos en la ficha del producto.",

  RECIPIENT_MISSING: "Falta el destinatario en Cuba.",
  RECIPIENT_FULL_NAME_MISSING: "Falta el nombre del destinatario.",
  RECIPIENT_IDENTITY_NUMBER_MISSING:
    "Falta el carné de identidad (CI) del destinatario.",
  RECIPIENT_DELIVERY_ADDRESS_MISSING: "Falta la dirección de entrega.",
  RECIPIENT_MUNICIPALITY_MISSING: "Falta el municipio del destinatario.",
  RECIPIENT_PROVINCE_MISSING: "Selecciona la provincia del destinatario.",
  RECIPIENT_PRIMARY_PHONE_MISSING:
    "Falta el teléfono principal del destinatario.",
  RECIPIENT_DOCUMENT_FRONT_MISSING: "Falta el documento frontal del destinatario.",
  RECIPIENT_DOCUMENT_BACK_MISSING: "Falta el documento reverso del destinatario.",

  DELIVERY_MISSING: "Falta la información de entrega.",
  DELIVERY_METHOD_MISSING: "Selecciona un método de entrega.",

  NO_PAYMENT_ALLOCATIONS: "No has seleccionado un método de pago.",
  PAYMENT_METHOD_MISSING: "Un método de pago ya no existe.",
  PAYMENT_METHOD_INACTIVE: "La financiera seleccionada ya no está activa.",
  PAYMENT_PLAN_REQUIRED: "Selecciona el plazo de la financiera.",
  PAYMENT_PLAN_MISMATCH: "El plazo no corresponde a esa financiera.",
  PAYMENT_FEE_MISMATCH:
    "La comisión del método cambió. Vuelve a abrir la venta y guarda de nuevo.",
  PAYMENT_METHOD_FLORIDA_ONLY:
    "Un método de pago solo está disponible para clientes de Florida (FL).",
  PAYMENT_UNDERFUNDED: "El neto acreditado no cubre el total de la venta.",
  PAYMENT_OVERFUNDED: "La liquidación supera el total de la venta.",

  // Cierre comercial (mark_sale_sold) — vendedor o admin, mismas reglas.
  CONTRACT_UNSIGNED: "Falta firmar un contrato de financiación obligatorio.",
  COMMISSION_CONFIG_MISSING:
    "Falta el precio fijo de venta o la comisión fija de un producto de esta venta. Un administrador debe completarlos en la ficha del producto.",
  WEEK_NOT_CLOSED: "Esta semana todavía está en curso.",
  COMMISSION_LOCKED: "La comisión de esa unidad ya está incluida en una liquidación: su precio no puede cambiar.",
  REQUEST_CONFLICT: "La venta cambió desde que se solicitó la edición.",
};

export function confirmErrorText(code: string): string {
  return CONFIRM_ERROR_MESSAGES[code] ?? "Revisa la información de la venta.";
}

/** Código de error → id de sección del formulario (para volver y enfocar). */
export function confirmErrorSection(code: string): string | null {
  if (code.startsWith("BUYER_")) return "section-buyer";
  if (code.startsWith("UNIT_") || code === "NO_SALE_UNITS") return "section-units";
  if (code.startsWith("RECIPIENT_")) return "section-recipient";
  if (code.startsWith("DELIVERY_")) return "section-delivery";
  if (code.startsWith("PAYMENT_") || code === "NO_PAYMENT_ALLOCATIONS") {
    return "section-payments";
  }
  return null;
}
