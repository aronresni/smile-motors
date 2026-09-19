import { centsToInputvalue, formatCents, parseAmountToCents } from "@/lib/money";
import { isPricingConfigured } from "@/lib/commission";
import type { CubaSaleDraftDto } from "@/lib/sales/draft-transport";

/**
 * Modelo PURO del editor administrativo de ventas (sin React): estado
 * inicial desde la venta persistida, validación, diff legible para la
 * confirmación y payload para `admin_update_cuba_sale`.
 *
 * El navegador NUNCA envía totales, snapshots ni comisiones: solo los
 * valores editables. El servidor re-deriva todo lo demás.
 */

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));

export interface UnitRow {
  key: string;
  id: string | null;
  productId: string;
  productName: string;
  variantId: string;
  variantLabel: string;
  agreedPrice: string;
  trackingCode: string | null;
  hasCommission: boolean;
  /**
   * Precio fijo / comisión fija VIGENTES del producto (`undefined` = sin
   * cargar, `null` = sin configurar). Se usan mientras la unidad no tiene
   * comisión congelada.
   */
  fixedPriceCents?: number | null;
  fixedCommissionCents?: number | null;
  /** Snapshot congelado al marcar VENDIDA (mínimo y base del recálculo). */
  frozenFixedPriceCents: number | null;
  frozenFixedCommissionCents: number | null;
}

/** Datos de comisión que el editor necesita por unidad. */
export interface UnitPricingInput {
  /** Snapshot por `sale_unit_id` (unidades con comisión ya calculada). */
  frozen: Record<string, { fixedPriceCents: number; fixedCommissionCents: number }>;
  /** Configuración vigente por `product_id`. */
  products: Record<string, { fixedPriceCents: number | null; fixedCommissionCents: number | null }>;
}
export interface ExtraRow {
  key: string;
  id: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
}
export interface AdminSaleEditState {
  buyer: {
    firstName: string; lastName: string; dateOfBirth: string; documentNumber: string; documentExpiration: string;
    phone: string; email: string; addressLine1: string; addressLine2: string; city: string; state: string; postalCode: string;
  };
  hasCoBuyer: boolean;
  coBuyer: { firstName: string; lastName: string; dateOfBirth: string; documentNumber: string; phone: string; email: string };
  recipient: {
    fullName: string; identityNumber: string; deliveryAddress: string; municipality: string; province: string;
    phonePrimary: string; phoneSecondary: string;
  };
  delivery: { method: string; reference: string };
  internalNotes: string;
  units: UnitRow[];
  extras: ExtraRow[];
}

export function buildInitialState(
  dto: CubaSaleDraftDto,
  pricing: UnitPricingInput,
): AdminSaleEditState {
  const b = dto.buyer ?? {};
  const cb = dto.coBuyer ?? null;
  const r = dto.cubaRecipient ?? {};
  const d = dto.delivery ?? {};
  return {
    buyer: {
      firstName: str(b.first_name), lastName: str(b.last_name), dateOfBirth: str(b.date_of_birth),
      documentNumber: str(b.document_number), documentExpiration: str(b.document_expiration),
      phone: str(b.phone), email: str(b.email), addressLine1: str(b.address_line1), addressLine2: str(b.address_line2),
      city: str(b.city), state: str(b.state), postalCode: str(b.postal_code),
    },
    hasCoBuyer: Boolean(cb),
    coBuyer: {
      firstName: str(cb?.first_name), lastName: str(cb?.last_name), dateOfBirth: str(cb?.date_of_birth),
      documentNumber: str(cb?.document_number), phone: str(cb?.phone), email: str(cb?.email),
    },
    recipient: {
      fullName: str(r.full_name), identityNumber: str(r.identity_number), deliveryAddress: str(r.delivery_address),
      municipality: str(r.municipality), province: str(r.province), phonePrimary: str(r.primary_phone),
      phoneSecondary: str(r.secondary_phone),
    },
    delivery: { method: str(d.method), reference: str(d.pickup_reference) },
    internalNotes: str(dto.sale.internal_notes),
    units: dto.units.map((u) => ({
      key: str(u.id),
      id: str(u.id),
      productId: str(u.product_id),
      productName: str(u.product_name_snapshot),
      variantId: str(u.product_variant_id),
      variantLabel: str(u.variant_snapshot),
      agreedPrice: centsToInputvalue(Number(u.agreed_price_cents) || 0),
      trackingCode: u.tracking_code ? str(u.tracking_code) : null,
      hasCommission: Boolean(pricing.frozen[str(u.id)]),
      fixedPriceCents: pricing.products[str(u.product_id)]?.fixedPriceCents ?? null,
      fixedCommissionCents: pricing.products[str(u.product_id)]?.fixedCommissionCents ?? null,
      frozenFixedPriceCents: pricing.frozen[str(u.id)]?.fixedPriceCents ?? null,
      frozenFixedCommissionCents: pricing.frozen[str(u.id)]?.fixedCommissionCents ?? null,
    })),
    extras: dto.extras.map((e) => ({
      key: str(e.id),
      id: str(e.id),
      description: str(e.description),
      quantity: String(Number(e.quantity) || 1),
      unitPrice: centsToInputvalue(Number(e.unit_price_cents) || 0),
    })),
  };
}

export type FieldErrors = Record<string, string>;

/**
 * Precio fijo y comisión que rigen una unidad: los CONGELADOS si ya tiene
 * comisión (VENDIDA); si no, los vigentes del producto.
 */
export function unitPricing(u: UnitRow): { fixedPriceCents: number | null | undefined; fixedCommissionCents: number | null | undefined; frozen: boolean } {
  if (u.hasCommission && u.frozenFixedPriceCents != null) {
    return { fixedPriceCents: u.frozenFixedPriceCents, fixedCommissionCents: u.frozenFixedCommissionCents, frozen: true };
  }
  return { fixedPriceCents: u.fixedPriceCents, fixedCommissionCents: u.fixedCommissionCents, frozen: false };
}

/** ¿La unidad es nueva o cambió su producto / precio respecto del original? */
function unitChanged(u: UnitRow, initial?: AdminSaleEditState): boolean {
  if (!initial) return true;
  const o = initial.units.find((x) => x.key === u.key);
  return !o || o.productId !== u.productId || parseAmountToCents(o.agreedPrice) !== parseAmountToCents(u.agreedPrice);
}

/**
 * Validación del editor. El mínimo (precio fijo) se comprueba solo en unidades
 * nuevas o modificadas — igual que el servidor: una edición no relacionada
 * nunca queda bloqueada por un cambio posterior del precio fijo.
 */
export function validate(s: AdminSaleEditState, initial?: AdminSaleEditState, status?: string): FieldErrors {
  const e: FieldErrors = {};
  const req = (key: string, value: string, msg: string) => {
    if (!value.trim()) e[key] = msg;
  };
  req("buyer.firstName", s.buyer.firstName, "Escribe el nombre del comprador.");
  req("buyer.lastName", s.buyer.lastName, "Escribe los apellidos del comprador.");
  req("buyer.documentNumber", s.buyer.documentNumber, "Escribe el N.º de documento.");
  req("buyer.phone", s.buyer.phone, "Escribe el teléfono del comprador.");
  if (s.buyer.email.trim() && !/^\S+@\S+\.\S+$/.test(s.buyer.email.trim())) e["buyer.email"] = "Correo no válido.";
  req("recipient.fullName", s.recipient.fullName, "Escribe el nombre del destinatario.");
  req("recipient.identityNumber", s.recipient.identityNumber, "Escribe el CI/NI del destinatario.");
  req("recipient.deliveryAddress", s.recipient.deliveryAddress, "Escribe la dirección de entrega.");
  req("recipient.province", s.recipient.province, "Selecciona la provincia.");
  req("recipient.phonePrimary", s.recipient.phonePrimary, "Escribe el teléfono principal.");
  if (!s.delivery.method) e["delivery.method"] = "Selecciona el método de entrega.";
  if (s.units.length === 0) e["units"] = "La venta debe tener al menos una unidad.";
  s.units.forEach((u) => {
    if (!u.productId) e[`unit.${u.key}.product`] = "Selecciona un producto.";
    const price = parseAmountToCents(u.agreedPrice);
    if (price <= 0) {
      e[`unit.${u.key}.price`] = "El precio de venta debe ser mayor que 0.";
      return;
    }
    if (!u.productId || !unitChanged(u, initial)) return;
    const p = unitPricing(u);
    if (p.fixedPriceCents === undefined) return; // aún sin cargar: decide el servidor
    if (!p.frozen && !isPricingConfigured(p.fixedPriceCents, p.fixedCommissionCents)) {
      if (status !== "DRAFT") {
        e[`unit.${u.key}.price`] = "Este producto no tiene precio fijo de venta o comisión fija. Configúralo en su ficha.";
      }
    } else if (p.fixedPriceCents != null && price < p.fixedPriceCents) {
      e[`unit.${u.key}.price`] = `No puede ser inferior al precio fijo (${formatCents(p.fixedPriceCents)}).`;
    }
  });
  s.extras.forEach((x) => {
    if (!(Number.parseInt(x.quantity, 10) >= 1)) e[`extra.${x.key}.quantity`] = "Cantidad mínima 1.";
  });
  return e;
}

export function estimateTotalCents(s: AdminSaleEditState, deliveryCents: number): number {
  const units = s.units.reduce((a, u) => a + parseAmountToCents(u.agreedPrice), 0);
  const extras = s.extras.reduce(
    (a, x) => a + Math.max(1, Number.parseInt(x.quantity, 10) || 1) * Math.max(0, parseAmountToCents(x.unitPrice)),
    0,
  );
  return units + extras + deliveryCents;
}

export function toPayload(s: AdminSaleEditState): Record<string, unknown> {
  return {
    buyer: { ...s.buyer },
    coBuyer: s.hasCoBuyer ? { ...s.coBuyer } : null,
    cubaRecipient: { ...s.recipient },
    delivery: { method: s.delivery.method || null, reference: s.delivery.reference },
    internalNotes: s.internalNotes,
    units: s.units.map((u) => ({
      id: u.id,
      productId: u.productId,
      variantId: u.variantId || null,
      agreedPriceCents: parseAmountToCents(u.agreedPrice),
    })),
    extras: s.extras.map((x) => ({
      id: x.id,
      description: x.description,
      quantity: Math.max(1, Number.parseInt(x.quantity, 10) || 1),
      unitAmountCents: Math.max(0, parseAmountToCents(x.unitPrice)),
    })),
  };
}

export interface ChangeLine {
  section: string;
  label: string;
  from: string;
  to: string;
  financial?: boolean;
}

const DELIVERY_LABEL: Record<string, string> = {
  HOME_DELIVERY: "Entrega a domicilio",
  PICKUP_POINT: "Punto de recogida",
};

/** Diff legible (previsualización). La auditoría autoritativa la escribe el servidor. */
export function diffState(a: AdminSaleEditState, b: AdminSaleEditState): ChangeLine[] {
  const out: ChangeLine[] = [];
  const push = (section: string, label: string, x: string, y: string, financial = false) => {
    if (x.trim() !== y.trim()) out.push({ section, label, from: x.trim() || "—", to: y.trim() || "—", financial });
  };
  const BUYER: [keyof AdminSaleEditState["buyer"], string][] = [
    ["firstName", "Nombre"], ["lastName", "Apellidos"], ["dateOfBirth", "Fecha de nacimiento"],
    ["documentNumber", "N.º de documento"], ["documentExpiration", "Vencimiento del documento"],
    ["phone", "Teléfono"], ["email", "Correo"], ["addressLine1", "Dirección"], ["addressLine2", "Dirección (línea 2)"],
    ["city", "Ciudad"], ["state", "Estado"], ["postalCode", "Código postal"],
  ];
  BUYER.forEach(([k, l]) => push("Comprador", l, a.buyer[k], b.buyer[k]));

  if (a.hasCoBuyer !== b.hasCoBuyer) {
    out.push({
      section: "Segundo titular",
      label: b.hasCoBuyer ? "Agregado" : "Eliminado",
      from: a.hasCoBuyer ? `${a.coBuyer.firstName} ${a.coBuyer.lastName}`.trim() : "—",
      to: b.hasCoBuyer ? `${b.coBuyer.firstName} ${b.coBuyer.lastName}`.trim() : "—",
    });
  } else if (b.hasCoBuyer) {
    const CB: [keyof AdminSaleEditState["coBuyer"], string][] = [
      ["firstName", "Nombre"], ["lastName", "Apellidos"], ["dateOfBirth", "Fecha de nacimiento"],
      ["documentNumber", "N.º de documento"], ["phone", "Teléfono"], ["email", "Correo"],
    ];
    CB.forEach(([k, l]) => push("Segundo titular", l, a.coBuyer[k], b.coBuyer[k]));
  }

  const REC: [keyof AdminSaleEditState["recipient"], string][] = [
    ["fullName", "Nombre"], ["identityNumber", "CI / NI"], ["deliveryAddress", "Dirección de entrega"],
    ["municipality", "Municipio"], ["province", "Provincia"], ["phonePrimary", "Teléfono principal"],
    ["phoneSecondary", "Teléfono secundario"],
  ];
  REC.forEach(([k, l]) => push("Destinatario", l, a.recipient[k], b.recipient[k]));
  push("Entrega", "Método", DELIVERY_LABEL[a.delivery.method] ?? a.delivery.method, DELIVERY_LABEL[b.delivery.method] ?? b.delivery.method);
  push("Entrega", "Referencia", a.delivery.reference, b.delivery.reference);
  push("Notas", "Notas internas", a.internalNotes, b.internalNotes);

  const money = (v: string) => formatCents(parseAmountToCents(v));
  for (const u of b.units) {
    const o = a.units.find((x) => x.key === u.key);
    if (!o) {
      out.push({ section: "Unidades", label: "Unidad agregada", from: "—", to: `${u.productName || "—"} · ${money(u.agreedPrice)}`, financial: true });
      continue;
    }
    push("Unidades", `${o.productName} · producto`, o.productName, u.productName, true);
    push("Unidades", `${u.productName} · variante`, o.variantLabel, u.variantLabel);
    if (parseAmountToCents(o.agreedPrice) !== parseAmountToCents(u.agreedPrice)) {
      out.push({ section: "Unidades", label: `${u.productName} · precio acordado`, from: money(o.agreedPrice), to: money(u.agreedPrice), financial: true });
    }
  }
  for (const o of a.units) {
    if (!b.units.some((x) => x.key === o.key)) {
      out.push({ section: "Unidades", label: "Unidad eliminada", from: `${o.productName} · ${money(o.agreedPrice)}`, to: "—", financial: true });
    }
  }
  for (const x of b.extras) {
    const o = a.extras.find((y) => y.key === x.key);
    if (!o) {
      out.push({ section: "Extras", label: "Extra agregado", from: "—", to: `${x.description || "Extra"} ×${x.quantity} · ${money(x.unitPrice)}`, financial: true });
      continue;
    }
    push("Extras", "Descripción", o.description, x.description);
    push("Extras", `${x.description || "Extra"} · cantidad`, o.quantity, x.quantity, true);
    if (parseAmountToCents(o.unitPrice) !== parseAmountToCents(x.unitPrice)) {
      out.push({ section: "Extras", label: `${x.description || "Extra"} · precio`, from: money(o.unitPrice), to: money(x.unitPrice), financial: true });
    }
  }
  for (const o of a.extras) {
    if (!b.extras.some((y) => y.key === o.key)) {
      out.push({ section: "Extras", label: "Extra eliminado", from: `${o.description || "Extra"} ×${o.quantity}`, to: "—", financial: true });
    }
  }
  return out;
}
