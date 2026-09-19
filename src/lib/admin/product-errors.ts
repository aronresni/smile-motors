/** Códigos de las acciones de administración de productos → mensaje simple. */
const MESSAGES: Record<string, string> = {
  NOT_AUTHENTICATED: "Tu sesión no es válida. Inicia sesión de nuevo.",
  NOT_ADMIN: "Solo un administrador puede realizar esta acción.",
  INVALID_INPUT: "Revisa los datos del producto.",
  INVALID_PRICE: "Los precios deben ser mayores o iguales a cero.",
  LEGACY_ID_ALREADY_EXISTS: "Ya existe un producto con ese ID legado.",
  PRODUCT_NOT_FOUND: "No encontramos este producto.",
  VARIANT_NOT_FOUND: "No encontramos esta variante.",
  VARIANT_ALREADY_EXISTS: "Ya existe una variante con ese color en este producto.",
  IMAGE_NOT_FOUND: "No encontramos esta imagen.",
  UNEXPECTED: "No se pudo completar la acción. Intenta de nuevo.",
};

export function productActionErrorText(code: string | undefined): string {
  if (!code) return MESSAGES.UNEXPECTED;
  return MESSAGES[code] ?? MESSAGES.UNEXPECTED;
}
