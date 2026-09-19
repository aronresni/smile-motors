import { CONFIRM_ERROR_MESSAGES } from "@/lib/sales/confirm-errors";

/**
 * Códigos de las acciones de control de venta del Admin → español claro.
 * Nunca se muestra el error técnico; los códigos de validación de datos
 * reutilizan el mapa ya existente (`CONFIRM_ERROR_MESSAGES`).
 */
const MESSAGES: Record<string, string> = {
  NOT_ADMIN: "Solo un administrador puede realizar esta acción.",
  SALE_CHANGED:
    "La venta cambió mientras la editabas (otra persona la actualizó). Recarga para ver la versión actual.",
  PAID_REQUIRES_ADMIN_CORRECTION:
    "Una venta pagada solo se modifica mediante una corrección administrativa, con motivo y confirmación.",
  PAID_FINANCIAL_CHANGE_BLOCKED:
    "En una venta pagada no se pueden cambiar importes, unidades ni extras: la verdad financiera ya está cerrada. Esa corrección requiere el flujo de conciliación.",
  UNIT_STRUCTURE_LOCKED:
    "Una venta vendida o pagada no admite agregar ni quitar unidades (afecta comisión, seguimiento y logística).",
  UNIT_PRODUCT_LOCKED_COMMISSION:
    "No se puede cambiar el producto de una unidad cuya comisión ya fue calculada al marcarla vendida.",
  COMMISSION_LOCKED:
    "La comisión de esa unidad ya es elegible o está liquidada: el precio no puede cambiar sin una corrección específica.",
  INVALID_PAYLOAD: "Los datos enviados no son válidos.",
  REASON_REQUIRED: "Escribe el motivo del cambio (mínimo 4 caracteres). Queda en la auditoría.",
  UNIT_ID_UNKNOWN: "Una de las unidades ya no existe en esta venta. Recarga la página.",
  NO_UNITS: "La venta debe tener al menos una unidad.",
  UNIT_PRODUCT_INVALID: "Un producto seleccionado no existe o ya no está activo.",
  REQUIRED_DOCUMENT_REMOVAL: "No se puede quitar un documento obligatorio.",
  DELIVERY_METHOD_INVALID: "El método de entrega no es válido.",
  ALREADY_SETTLED: "Ese pago ya estaba liquidado.",
  ALLOCATION_NOT_FOUND: "No encontramos ese pago.",
  USE_FINANCING_FLOW: "Los pagos con financiera se acreditan desde su contrato.",
  PAYMENT_UNDERFUNDED:
    "Los pagos asignados no cubren el total de la venta. Devuélvela a borrador para que el vendedor ajuste los pagos.",
  PAYMENT_OVERFUNDED:
    "Los pagos asignados superan el total de la venta. Devuélvela a borrador para que el vendedor ajuste los pagos.",
};

export function saleControlErrorText(code: string | undefined, detail?: { providers?: string[]; errors?: string[] }): string {
  if (!code) return "No pudimos completar la acción. Intenta de nuevo.";
  if (code === "CONTRACT_UNSIGNED" && detail?.providers?.length) {
    return `Falta firmar el contrato de ${detail.providers.join(", ")}. La venta no puede marcarse vendida hasta entonces.`;
  }
  if (code === "VALIDATION_FAILED" && detail?.errors?.length) {
    const first = detail.errors.map((e) => MESSAGES[e] ?? CONFIRM_ERROR_MESSAGES[e]).filter(Boolean);
    if (first.length) {
      return first.length === 1 ? first[0] : `${first[0]} (y ${first.length - 1} problema(s) más)`;
    }
  }
  return MESSAGES[code] ?? CONFIRM_ERROR_MESSAGES[code] ?? "No pudimos completar la acción. Intenta de nuevo.";
}

/** Lista completa de problemas de validación, ya traducidos. */
export function validationList(errors: string[] | undefined): string[] {
  return (errors ?? []).map((e) => MESSAGES[e] ?? CONFIRM_ERROR_MESSAGES[e] ?? e);
}
