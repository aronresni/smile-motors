/**
 * Textos de auditoría de `sale_change_history` — usados por
 * `SaleChangeHistory` (vendedor y admin) para mostrar cada cambio
 * registrado, venga de una edición directa histórica o de una solicitud de
 * edición aprobada. Puro: sin dependencias de red.
 */
import { formatCents } from "@/lib/money";

const STATIC_FIELD_LABELS: Record<string, string> = {
  "buyer.first_name": "Comprador · nombre",
  "buyer.last_name": "Comprador · apellidos",
  "buyer.date_of_birth": "Comprador · nacimiento",
  "buyer.document_number": "Comprador · N.º de documento",
  "buyer.document_expiration": "Comprador · vencimiento",
  "buyer.phone": "Comprador · teléfono",
  "buyer.email": "Comprador · email",
  "buyer.address_line1": "Comprador · dirección",
  "buyer.address_line2": "Comprador · dirección 2",
  "buyer.city": "Comprador · ciudad",
  "buyer.state": "Comprador · estado",
  "buyer.postal_code": "Comprador · código postal",
  co_buyer: "Co-comprador",
  "co_buyer.first_name": "Co-comprador · nombre",
  "co_buyer.last_name": "Co-comprador · apellidos",
  "co_buyer.date_of_birth": "Co-comprador · nacimiento",
  "co_buyer.document_number": "Co-comprador · N.º de documento",
  "co_buyer.phone": "Co-comprador · teléfono",
  "co_buyer.email": "Co-comprador · email",
  "recipient.full_name": "Destinatario · nombre",
  "recipient.identity_number": "Destinatario · CI",
  "recipient.delivery_address": "Destinatario · dirección de entrega",
  "recipient.municipality": "Destinatario · municipio",
  "recipient.province": "Destinatario · provincia",
  "recipient.primary_phone": "Destinatario · teléfono",
  "recipient.secondary_phone": "Destinatario · teléfono secundario",
  "delivery.method": "Entrega · método",
  "delivery.pickup_reference": "Entrega · referencia de recogida",
  internal_notes: "Notas internas",
  "totals.units_total_cents": "Total · unidades",
  "totals.extras_total_cents": "Total · extras",
  "totals.sale_total_cents": "Total de la venta",
};

const UNIT_SUBFIELD: Record<string, string> = {
  product: "Unidad · modelo",
  variant: "Unidad · color",
  agreed_price_cents: "Unidad · precio de venta",
};
const EXTRA_SUBFIELD: Record<string, string> = {
  description: "Extra · descripción",
  quantity: "Extra · cantidad",
  unit_price_cents: "Extra · importe",
};

export function describeChangeField(fieldPath: string): string {
  if (STATIC_FIELD_LABELS[fieldPath]) return STATIC_FIELD_LABELS[fieldPath];

  const parts = fieldPath.split(".");
  if (parts[0] === "units") {
    return parts[2] ? (UNIT_SUBFIELD[parts[2]] ?? "Unidad") : "Unidad";
  }
  if (parts[0] === "extras") {
    return parts[2] ? (EXTRA_SUBFIELD[parts[2]] ?? "Extra") : "Extra";
  }
  if (parts[0] === "documents") {
    const subject =
      parts[1] === "buyer"
        ? "Comprador"
        : parts[1] === "cuba_recipient"
          ? "Destinatario"
          : "Co-comprador";
    const side = parts[2] === "front" ? "anverso" : "reverso";
    return `Documento · ${subject} (${side})`;
  }
  return fieldPath;
}

const MONEY_FIELD_SUFFIXES = [
  "agreed_price_cents",
  "unit_price_cents",
  "units_total_cents",
  "extras_total_cents",
  "sale_total_cents",
];

export function isMoneyChangeField(fieldPath: string): boolean {
  return MONEY_FIELD_SUFFIXES.some((s) => fieldPath.endsWith(s));
}

export function formatAuditValue(
  fieldPath: string,
  value: string | null,
): string {
  if (value === null || value === "") return "—";
  if (isMoneyChangeField(fieldPath)) {
    const n = Number(value);
    return Number.isFinite(n) ? formatCents(n) : value;
  }
  return value;
}
