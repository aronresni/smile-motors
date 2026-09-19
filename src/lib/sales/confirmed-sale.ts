/**
 * Modelo de dominio de una venta (borrador en revisión o confirmada) y los
 * generadores de mensajes. Puro: se construye desde datos PERSISTIDOS
 * (`CubaSaleDraftDto`), nunca desde el estado temporal del formulario.
 *
 * Los mensajes NO incluyen: número de licencia del comprador, fecha de
 * nacimiento, ni URLs de documentos privados.
 */
import type { CubaSaleDraftDto } from "@/lib/sales/draft-transport";
import type { DealerInfo } from "@/config/dealer";
import { formatCents, multiplyCents, sumCents } from "@/lib/money";

const str = (v: unknown): string =>
  typeof v === "string" ? v : v === null || v === undefined ? "" : String(v);
const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

export type DeliveryMethodCode = "HOME_DELIVERY" | "PICKUP_POINT" | null;

export interface ConfirmedSaleUnit {
  id: string;
  productName: string;
  brand: string;
  variant: string;
  listPriceCentsSnapshot: number | null;
  cubaTotalCentsSnapshot: number | null;
  agreedPriceCents: number;
  trackingCode: string | null;
}

export interface ConfirmedSaleExtra {
  description: string;
  quantity: number;
  unitPriceCents: number;
}

export interface FinancingContractModel {
  id: string;
  status: "SENT" | "SIGNED" | "ACCREDITED" | string;
  planLabel: string | null;
  planCode: string | null;
  grossCents: number;
  feeCents: number;
  netCents: number;
  contractSignedUrl: string | null;
  sentAt: string;
  sentByName: string | null;
  signedAt: string | null;
  signedByName: string | null;
  accreditedAt: string | null;
  accreditedByName: string | null;
}

export interface ConfirmedSalePayment {
  allocationId: string;
  providerName: string;
  methodType: string;
  planLabel: string | null;
  feeStrategy: string;
  inputMode: "GROSS" | "NET";
  grossCents: number;
  feeCents: number;
  netCents: number;
  feeBps: number | null;
  reference: string | null;
  /** Estado operativo de pagos directos (CARD/ZELLE/INTERNAL). */
  settlementStatus: "PENDING" | "SETTLED" | string;
  /** Si este método exige contrato firmado antes de poder marcar SOLD. */
  requiresSignedContract: boolean;
  /** Presente solo para methodType === "FINANCING". */
  financingContract: FinancingContractModel | null;
}

export interface SettlementModel {
  status: "PENDING_COLLECTION" | "PAID" | null;
  closingReviewedAt: string | null;
  closingReviewedByName: string | null;
  amountCollectedCents: number;
  amountOutstandingCents: number;
  saleTotalCents: number;
  readyForPaid: boolean;
}

export interface StatusHistoryEntry {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  changedAt: string;
  changedByName: string | null;
  reason: string | null;
}

export interface ConfirmedSaleModel {
  saleId: string;
  saleNumber: string | null;
  status: string;
  saleDate: string | null;
  reviewRequestedAt: string | null;
  soldAt: string | null;
  paidAt: string | null;
  sellerName: string;
  buyer: {
    fullName: string;
    phone: string;
    email: string;
    documentNumber: string;
    addressLine: string;
    docFront: boolean;
    docBack: boolean;
  };
  coBuyer: {
    fullName: string;
    phone: string;
    email: string;
    documentNumber: string;
    /** El ID del co-buyer es opcional: solo se muestra si se subió. */
    docFront: boolean;
    docBack: boolean;
  } | null;
  units: ConfirmedSaleUnit[];
  extras: ConfirmedSaleExtra[];
  recipient: {
    fullName: string;
    identityNumber: string;
    deliveryAddress: string;
    municipality: string;
    province: string;
    primaryPhone: string;
    secondaryPhone: string;
    docFront: boolean;
    docBack: boolean;
  };
  delivery: {
    method: DeliveryMethodCode;
    pickupReference: string;
    notes: string;
  };
  internalNotes: string;
  payments: ConfirmedSalePayment[];
  /** Todas las allocations de tipo FINANCING tienen contrato ACCREDITADO. */
  financingComplete: boolean;
  /** Métodos con `requiresSignedContract` cuyo contrato NO está SIGNED/ACCREDITED. */
  unsignedRequiredProviders: string[];
  statusHistory: StatusHistoryEntry[];
  settlement: SettlementModel;
  totals: {
    unitsCents: number;
    extrasCents: number;
    deliveryCents: number;
    saleCents: number;
    /** Σ neto acreditado por las allocations. */
    netCoveredCents: number;
  };
}

export function deliveryMethodLabel(method: DeliveryMethodCode): string {
  if (method === "HOME_DELIVERY") return "Entrega puerta a puerta";
  if (method === "PICKUP_POINT") return "Punto de recogida";
  return "—";
}

export function buildConfirmedSaleModel(
  dto: CubaSaleDraftDto,
  sellerName: string,
): ConfirmedSaleModel {
  const b = dto.buyer ?? {};
  const cb = dto.coBuyer;
  const r = dto.cubaRecipient ?? {};
  const d = dto.delivery ?? {};
  const docs = dto.documents ?? [];
  const hasDoc = (subject: string, side: string) =>
    docs.some((x) => x.subjectType === subject && x.side === side);

  const units: ConfirmedSaleUnit[] = dto.units.map((u) => ({
    id: str(u.id),
    productName: str(u.product_name_snapshot),
    brand: str(u.brand_snapshot),
    variant: str(u.variant_snapshot),
    listPriceCentsSnapshot:
      u.list_price_cents_snapshot === null ||
      u.list_price_cents_snapshot === undefined
        ? null
        : num(u.list_price_cents_snapshot),
    cubaTotalCentsSnapshot:
      u.cuba_total_cents_snapshot === null ||
      u.cuba_total_cents_snapshot === undefined
        ? null
        : num(u.cuba_total_cents_snapshot),
    agreedPriceCents: num(u.agreed_price_cents),
    trackingCode: u.tracking_code ? str(u.tracking_code) : null,
  }));

  const extras: ConfirmedSaleExtra[] = dto.extras.map((e) => ({
    description: str(e.description),
    quantity: num(e.quantity) || 1,
    unitPriceCents: num(e.unit_price_cents),
  }));

  const unitsCents =
    dto.sale.units_total_cents ??
    sumCents(units.map((u) => u.agreedPriceCents));
  const extrasCents =
    dto.sale.extras_total_cents ??
    sumCents(extras.map((e) => multiplyCents(e.unitPriceCents, e.quantity)));
  const deliveryCents = dto.sale.delivery_total_cents ?? 0;
  const saleCents = dto.sale.sale_total_cents ?? unitsCents + extrasCents + deliveryCents;

  const contractsByAllocation = new Map(
    (dto.financingContracts ?? []).map((c) => [c.paymentAllocationId, c]),
  );

  const payments: ConfirmedSalePayment[] = (dto.paymentAllocations ?? []).map(
    (a) => {
      const c = contractsByAllocation.get(a.id);
      const financingContract: FinancingContractModel | null = c
        ? {
            id: str(c.id),
            status: str(c.status),
            planLabel: c.planLabelSnapshot ? str(c.planLabelSnapshot) : null,
            planCode: c.planCodeSnapshot ? str(c.planCodeSnapshot) : null,
            grossCents: num(c.grossAmountCents),
            feeCents: num(c.feeAmountCents),
            netCents: num(c.netAmountCents),
            contractSignedUrl: c.contractSignedUrl ?? null,
            sentAt: str(c.sentAt),
            sentByName: c.sentByName ? str(c.sentByName) : null,
            signedAt: c.signedAt ? str(c.signedAt) : null,
            signedByName: c.signedByName ? str(c.signedByName) : null,
            accreditedAt: c.accreditedAt ? str(c.accreditedAt) : null,
            accreditedByName: c.accreditedByName ? str(c.accreditedByName) : null,
          }
        : null;
      return {
        allocationId: str(a.id),
        providerName: str(a.providerNameSnapshot),
        methodType: str(a.methodType) || "FINANCING",
        planLabel: a.planLabelSnapshot ? str(a.planLabelSnapshot) : null,
        feeStrategy: str(a.feeStrategySnapshot),
        inputMode: a.inputMode === "NET" ? "NET" : "GROSS",
        grossCents: num(a.grossAmountCents),
        feeCents: num(a.feeAmountCents),
        netCents: num(a.netAmountCents),
        feeBps:
          a.feeBpsSnapshot === null || a.feeBpsSnapshot === undefined
            ? null
            : num(a.feeBpsSnapshot),
        reference: a.reference ? str(a.reference) : null,
        settlementStatus: str(a.settlementStatus) || "PENDING",
        requiresSignedContract: a.methodRequiresSignedContract === true,
        financingContract,
      };
    },
  );
  const netCoveredCents = sumCents(payments.map((p) => p.netCents));
  const financingPayments = payments.filter((p) => p.methodType === "FINANCING");
  const financingComplete =
    financingPayments.length > 0 &&
    financingPayments.every((p) => p.financingContract?.status === "ACCREDITED");
  const unsignedRequiredProviders = payments
    .filter(
      (p) =>
        p.requiresSignedContract &&
        p.financingContract?.status !== "SIGNED" &&
        p.financingContract?.status !== "ACCREDITED",
    )
    .map((p) => p.providerName);

  const s = dto.settlement;
  const settlement: SettlementModel = {
    status: (s?.status as SettlementModel["status"]) ?? null,
    closingReviewedAt: s?.closingReviewedAt ?? null,
    closingReviewedByName: s?.closingReviewedByName ?? null,
    amountCollectedCents: num(s?.amountCollectedCents),
    amountOutstandingCents: num(s?.amountOutstandingCents),
    saleTotalCents: num(s?.saleTotalCents) || saleCents,
    readyForPaid: s?.readyForPaid === true,
  };

  const statusHistory: StatusHistoryEntry[] = (dto.statusHistory ?? []).map((h) => ({
    id: str(h.id),
    fromStatus: h.fromStatus ? str(h.fromStatus) : null,
    toStatus: str(h.toStatus),
    changedAt: str(h.changedAt),
    changedByName: h.changedByName ? str(h.changedByName) : null,
    reason: h.reason ? str(h.reason) : null,
  }));

  const methodRaw = str(d.method);
  const method: DeliveryMethodCode =
    methodRaw === "HOME_DELIVERY"
      ? "HOME_DELIVERY"
      : methodRaw === "PICKUP_POINT"
        ? "PICKUP_POINT"
        : null;

  return {
    saleId: dto.sale.id,
    saleNumber: dto.sale.sale_number,
    status: dto.sale.status,
    saleDate: dto.sale.sale_date,
    reviewRequestedAt: dto.sale.review_requested_at,
    soldAt: dto.sale.sold_at,
    paidAt: dto.sale.paid_at,
    sellerName,
    buyer: {
      fullName: `${str(b.first_name)} ${str(b.last_name)}`.trim(),
      phone: str(b.phone),
      email: str(b.email),
      documentNumber: str(b.document_number),
      addressLine: [
        str(b.address_line1),
        str(b.address_line2),
        str(b.city),
        str(b.state),
        str(b.postal_code),
      ]
        .filter(Boolean)
        .join(", "),
      docFront: hasDoc("BUYER", "FRONT"),
      docBack: hasDoc("BUYER", "BACK"),
    },
    coBuyer: cb
      ? {
          fullName: `${str(cb.first_name)} ${str(cb.last_name)}`.trim(),
          phone: str(cb.phone),
          email: str(cb.email),
          documentNumber: str(cb.document_number),
          docFront: hasDoc("CO_BUYER", "FRONT"),
          docBack: hasDoc("CO_BUYER", "BACK"),
        }
      : null,
    units,
    extras,
    recipient: {
      fullName: str(r.full_name),
      identityNumber: str(r.identity_number),
      deliveryAddress: str(r.delivery_address),
      municipality: str(r.municipality),
      province: str(r.province),
      primaryPhone: str(r.primary_phone),
      secondaryPhone: str(r.secondary_phone),
      docFront: hasDoc("CUBA_RECIPIENT", "FRONT"),
      docBack: hasDoc("CUBA_RECIPIENT", "BACK"),
    },
    delivery: {
      method,
      pickupReference: str(d.pickup_reference),
      notes: str(d.delivery_notes),
    },
    internalNotes: str(dto.sale.internal_notes),
    payments,
    financingComplete,
    unsignedRequiredProviders,
    statusHistory,
    settlement,
    totals: { unitsCents, extrasCents, deliveryCents, saleCents, netCoveredCents },
  };
}

/* -------------------------------------------------------------------------- */
/* Generadores de mensajes                                                    */
/* -------------------------------------------------------------------------- */

export function generateCommercialSummary(m: ConfirmedSaleModel): string {
  const lines: string[] = [];
  lines.push(`VENTA: ${m.saleNumber ?? "(sin confirmar)"}`);
  if (m.saleDate) lines.push(`FECHA: ${m.saleDate}`);
  lines.push("");
  lines.push("VENDEDOR:");
  lines.push(m.sellerName || "—");
  lines.push("");
  lines.push("CLIENTE:");
  lines.push(m.buyer.fullName || "—");
  lines.push("");
  lines.push("TELÉFONO:");
  lines.push(m.buyer.phone || "—");
  if (m.buyer.email) {
    lines.push("");
    lines.push("EMAIL:");
    lines.push(m.buyer.email);
  }
  lines.push("");
  lines.push("PRODUCTOS:");
  m.units.forEach((u, i) => {
    lines.push(`${i + 1}. ${u.productName || "—"}`);
    if (u.variant) lines.push(`   Color: ${u.variant}`);
    lines.push(`   Precio de venta: ${formatCents(u.agreedPriceCents)}`);
  });
  if (m.extras.length) {
    lines.push("");
    lines.push("EXTRAS:");
    m.extras.forEach((e) => {
      lines.push(
        `- ${e.description || "Extra"} x${e.quantity}: ${formatCents(
          multiplyCents(e.unitPriceCents, e.quantity),
        )}`,
      );
    });
  }
  lines.push("");
  lines.push("TOTAL:");
  lines.push(formatCents(m.totals.saleCents));
  return lines.join("\n");
}

export function generateCubaShippingMessage(
  m: ConfirmedSaleModel,
  dealer: DealerInfo,
): string {
  const lines: string[] = [];
  lines.push("DATOS DE ENVÍO A CUBA");
  lines.push("");
  lines.push(`VENTA: ${m.saleNumber ?? "(sin confirmar)"}`);
  if (m.saleDate) lines.push(`FECHA: ${m.saleDate}`);
  lines.push("");
  lines.push("CONCESIONARIO:");
  lines.push(dealer.name);
  if (dealer.addressLine) lines.push(dealer.addressLine);
  lines.push("");
  lines.push("VENDEDOR:");
  lines.push(m.sellerName || "—");
  lines.push("");
  lines.push("REMITENTE / COMPRADOR:");
  lines.push(m.buyer.fullName || "—");
  lines.push(m.buyer.phone || "—");
  if (m.buyer.email) lines.push(m.buyer.email);
  lines.push("");
  lines.push("DESTINATARIO EN CUBA:");
  lines.push(m.recipient.fullName || "—");
  lines.push(m.recipient.primaryPhone || "—");
  if (m.recipient.secondaryPhone) lines.push(m.recipient.secondaryPhone);
  if (m.recipient.deliveryAddress) lines.push(m.recipient.deliveryAddress);
  const place = [m.recipient.municipality, m.recipient.province]
    .filter(Boolean)
    .join(", ");
  if (place) lines.push(place);
  if (m.recipient.identityNumber) lines.push(`CI: ${m.recipient.identityNumber}`);
  lines.push("");
  lines.push("PRODUCTOS:");
  m.units.forEach((u, i) => {
    lines.push(`${i + 1}. ${u.productName || "—"}`);
    if (u.variant) lines.push(`   Color: ${u.variant}`);
    lines.push(`   Tracking: ${u.trackingCode ?? "—"}`);
  });
  lines.push("");
  lines.push("ENTREGA:");
  lines.push(
    m.delivery.method === "PICKUP_POINT" && m.delivery.pickupReference
      ? `${deliveryMethodLabel(m.delivery.method)}: ${m.delivery.pickupReference}`
      : deliveryMethodLabel(m.delivery.method),
  );
  return lines.join("\n");
}
