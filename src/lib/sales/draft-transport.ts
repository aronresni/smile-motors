/**
 * Payload de transporte entre el formulario y la RPC `save_cuba_sale_draft`.
 * SOLO transporte: el backend lo desarma en tablas relacionales y NUNCA lo
 * guarda como jsonb. Los snapshots de producto los deriva el servidor.
 */
import type { CubaSaleFormValues } from "@/lib/sales/schema";
import type { DocumentUploadState } from "@/lib/sales/types";

export interface SaleDraftPayload {
  saleDate: string;
  shareCommission: boolean;
  internalNotes: string;
  buyer: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    documentNumber: string;
    documentExpiration: string;
    phone: string;
    email: string;
    addressLine1: string;
    addressLine2: string;
    city: string;
    state: string;
    postalCode: string;
  };
  coBuyer:
    | {
        firstName: string;
        lastName: string;
        dateOfBirth: string;
        documentNumber: string;
        phone: string;
        email: string;
      }
    | null;
  units: {
    productId: string;
    variantId: string | null;
    agreedPriceCents: number;
  }[];
  extras: {
    description: string;
    quantity: number;
    unitAmountCents: number;
  }[];
  cubaRecipient: {
    fullName: string;
    identityNumber: string;
    deliveryAddress: string;
    municipality: string;
    province: string;
    phonePrimary: string;
    phoneSecondary: string;
  };
  delivery: {
    method: string | null;
    reference: string;
  };
  paymentAllocations: {
    id: string | null;
    paymentMethodId: string;
    planId: string | null;
    inputMode: "GROSS" | "NET";
    amountCents: number;
    reference: string;
    notes: string;
  }[];
}

export function toDraftPayload(v: CubaSaleFormValues): SaleDraftPayload {
  return {
    saleDate: v.saleDate,
    shareCommission: v.commissionSharing.enabled,
    internalNotes: v.internalNotes,
    buyer: {
      firstName: v.buyer.firstName,
      lastName: v.buyer.lastName,
      dateOfBirth: v.buyer.dateOfBirth,
      documentNumber: v.buyer.documentNumber,
      documentExpiration: v.buyer.documentExpiration,
      phone: v.buyer.phone,
      email: v.buyer.email,
      addressLine1: v.buyer.addressLine1,
      addressLine2: v.buyer.addressLine2,
      city: v.buyer.city,
      state: v.buyer.state,
      postalCode: v.buyer.postalCode,
    },
    coBuyer: v.coBuyer
      ? {
          firstName: v.coBuyer.firstName,
          lastName: v.coBuyer.lastName,
          dateOfBirth: v.coBuyer.dateOfBirth,
          documentNumber: v.coBuyer.documentNumber,
          phone: v.coBuyer.phone,
          email: v.coBuyer.email,
        }
      : null,
    // Solo unidades con producto elegido: un borrador puede guardarse sin unidades.
    units: v.units
      .filter((u) => Boolean(u.catalogModelId))
      .map((u) => ({
        productId: u.catalogModelId as string,
        variantId: u.variantId,
        agreedPriceCents: u.agreedPriceCents,
      })),
    extras: v.extras.map((e) => ({
      description: e.description,
      quantity: e.quantity,
      unitAmountCents: e.unitAmountCents,
    })),
    cubaRecipient: {
      fullName: v.cubaRecipient.fullName,
      identityNumber: v.cubaRecipient.identityNumber,
      deliveryAddress: v.cubaRecipient.deliveryAddress,
      municipality: v.cubaRecipient.municipality,
      province: v.cubaRecipient.province,
      phonePrimary: v.cubaRecipient.phonePrimary,
      phoneSecondary: v.cubaRecipient.phoneSecondary,
    },
    delivery: {
      // el formulario usa minúsculas; la base usa MAYÚSCULAS
      method: v.delivery.method ? v.delivery.method.toUpperCase() : null,
      reference: v.delivery.reference,
    },
    // Solo allocations con método elegido. El backend recalcula fee/net.
    paymentAllocations: v.allocations
      .filter((a) => Boolean(a.paymentMethodId))
      .map((a) => ({
        id: a.id,
        paymentMethodId: a.paymentMethodId,
        planId: a.planId,
        inputMode: a.inputMode,
        amountCents: a.amountCents,
        reference: a.reference,
        notes: a.notes,
      })),
  };
}

/* ---------------------------------------------------------------------------
 * Forma que devuelve `get_cuba_sale_draft` y cómo rehidratar el formulario.
 * ------------------------------------------------------------------------- */
export interface CubaSaleDraftDto {
  sale: {
    id: string;
    operation_type: string;
    status: string;
    sale_date: string | null;
    share_commission: boolean;
    internal_notes: string | null;
    seller_id: string;
    currency: string;
    // Flujo comercial: DRAFT -> PENDING -> SOLD -> PAID
    review_requested_at: string | null;
    review_requested_by: string | null;
    // Presentes tras la aprobación (PENDING -> SOLD):
    sale_number: string | null;
    sold_at: string | null;
    sold_by: string | null;
    // Presente cuando un ADMIN confirma el pago (SOLD -> PAID, SIEMPRE una
    // acción humana explícita, nunca automática):
    paid_at: string | null;
    paid_by: string | null;
    // Estado de COBRO, SEPARADO del estado comercial (`status`). NULL
    // mientras la venta no es SOLD/PAID. Ver también `settlement` abajo
    // (mismos datos, pero calculado EN VIVO — úsalo para mostrar montos).
    settlement_status: "PENDING_COLLECTION" | "PAID" | null;
    closing_reviewed_at: string | null;
    closing_reviewed_by: string | null;
    units_total_cents: number | null;
    extras_total_cents: number | null;
    delivery_total_cents: number | null;
    sale_total_cents: number | null;
    /** Marcas de tiempo de la fila (`to_jsonb(sales.*)`). `updated_at` conserva
     * microsegundos: se reenvía TAL CUAL para detectar ediciones concurrentes. */
    created_at?: string;
    updated_at?: string;
  };
  seller: { id: string; fullName: string | null; email: string | null } | null;
  buyer: Record<string, unknown> | null;
  coBuyer: Record<string, unknown> | null;
  units: Record<string, unknown>[];
  extras: Record<string, unknown>[];
  cubaRecipient: Record<string, unknown> | null;
  delivery: Record<string, unknown> | null;
  documents: {
    subjectType: string; // BUYER | CO_BUYER | CUBA_RECIPIENT
    side: string; // FRONT | BACK
    storagePath: string;
    mimeType: string | null;
    fileSizeBytes: number | null;
    signedUrl?: string | null;
  }[];
  /** Liquidación de pagos persistida (snapshots históricos). */
  paymentAllocations?: {
    id: string;
    paymentMethodId: string;
    paymentMethodPlanId: string | null;
    position: number;
    inputMode: "GROSS" | "NET";
    grossAmountCents: number;
    feeAmountCents: number;
    netAmountCents: number;
    feeBpsSnapshot: number | null;
    fixedFeeCentsSnapshot: number | null;
    providerNameSnapshot: string;
    planLabelSnapshot: string | null;
    feeStrategySnapshot: string;
    methodType: string | null;
    methodOnlyFlorida: boolean | null;
    methodIsActive: boolean | null;
    /** Si el método exige contrato firmado antes de poder marcar SOLD. */
    methodRequiresSignedContract: boolean | null;
    /** Pagos directos (CARD/ZELLE/INTERNAL): estado de liquidación operativa. */
    settlementStatus: "PENDING" | "SETTLED" | string;
    settledAt: string | null;
    /** Si ya existe un contrato de financiación para esta allocation. */
    financingContractId: string | null;
    reference: string | null;
    notes: string | null;
  }[];
  /** Contratos de financiación (uno por allocation de tipo FINANCING enviada). */
  financingContracts?: {
    id: string;
    paymentAllocationId: string;
    paymentMethodId: string;
    status: "SENT" | "SIGNED" | "ACCREDITED" | string;
    grossAmountCents: number;
    feeAmountCents: number;
    netAmountCents: number;
    planLabelSnapshot: string | null;
    planCodeSnapshot: string | null;
    providerNameSnapshot: string;
    contractStoragePath: string | null;
    contractSignedUrl?: string | null;
    sentAt: string;
    sentByName: string | null;
    signedAt: string | null;
    signedByName: string | null;
    accreditedAt: string | null;
    accreditedByName: string | null;
  }[];
  /** Auditoría de progreso de cada contrato (para notas / detalle). */
  financingContractEvents?: {
    id: string;
    contractId: string;
    fromStatus: string | null;
    toStatus: string;
    changedAt: string;
    changedByName: string | null;
    note: string | null;
  }[];
  /** Auditoría de ediciones de venta confirmada (más reciente primero). */
  changeHistory?: {
    id: string;
    editGroup: string;
    changedAt: string;
    changedByName: string | null;
    reason: string | null;
    fieldPath: string;
    changeType: "UPDATE" | "ADD" | "REMOVE" | "REPLACE" | string;
    oldValue: string | null;
    newValue: string | null;
  }[];
  /** Historial de transiciones del estado comercial (DRAFT/PENDING/SOLD/PAID). */
  statusHistory?: {
    id: string;
    fromStatus: string | null;
    toStatus: string;
    changedAt: string;
    changedByName: string | null;
    reason: string | null;
  }[];
  /** Cobro, calculado EN VIVO server-side (nunca solo la foto guardada). */
  settlement?: {
    status: "PENDING_COLLECTION" | "PAID" | null;
    closingReviewedAt: string | null;
    closingReviewedByName: string | null;
    amountCollectedCents: number;
    amountOutstandingCents: number;
    saleTotalCents: number;
    /** Liquidación completa (100% cubierto) según los datos reales. NO
     * implica que la venta ya esté PAID — eso siempre lo confirma un admin. */
    readyForPaid: boolean;
  };
}

/* ---------------------------------------------------------------------------
 * Rehidratación del formulario a partir del borrador cargado.
 * ------------------------------------------------------------------------- */
const str = (v: unknown): string =>
  typeof v === "string" ? v : v === null || v === undefined ? "" : String(v);
const numOrNull = (v: unknown): number | null =>
  typeof v === "number" ? v : v === null || v === undefined ? null : Number(v);
const num = (v: unknown, fallback: number): number => {
  const n = numOrNull(v);
  return n === null || Number.isNaN(n) ? fallback : n;
};

function readyDocFromUrl(url: string | null | undefined): DocumentUploadState | null {
  if (!url) return null;
  return {
    status: "ready",
    dataUrl: url,
    fileName: null,
    originalDataUrl: null,
    error: null,
  };
}

/** Mezcla los datos del borrador sobre los valores por defecto del formulario. */
export function hydrateFormValues(
  base: CubaSaleFormValues,
  dto: CubaSaleDraftDto,
): CubaSaleFormValues {
  const b = dto.buyer ?? {};
  const r = dto.cubaRecipient ?? {};

  const next: CubaSaleFormValues = {
    ...base,
    saleDate: dto.sale.sale_date ?? base.saleDate,
    internalNotes: str(dto.sale.internal_notes),
    commissionSharing: {
      enabled: Boolean(dto.sale.share_commission),
      partnerSellerId: null,
    },
    buyer: {
      ...base.buyer,
      firstName: str(b.first_name),
      lastName: str(b.last_name),
      dateOfBirth: str(b.date_of_birth),
      documentNumber: str(b.document_number),
      documentExpiration: str(b.document_expiration),
      phone: str(b.phone),
      email: str(b.email),
      addressLine1: str(b.address_line1),
      addressLine2: str(b.address_line2),
      city: str(b.city),
      state: str(b.state),
      postalCode: str(b.postal_code),
    },
    coBuyer: dto.coBuyer
      ? {
          firstName: str(dto.coBuyer.first_name),
          lastName: str(dto.coBuyer.last_name),
          dateOfBirth: str(dto.coBuyer.date_of_birth),
          documentNumber: str(dto.coBuyer.document_number),
          phone: str(dto.coBuyer.phone),
          email: str(dto.coBuyer.email),
        }
      : null,
    units: dto.units.length
      ? dto.units.map((u, i) => ({
          key: str(u.id) || `unit-${i}`,
          catalogModelId: str(u.product_id) || null,
          modelName: str(u.product_name_snapshot),
          variantId: u.product_variant_id ? str(u.product_variant_id) : null,
          variantLabel: str(u.variant_snapshot),
          listPriceCents:
            numOrNull(u.list_price_cents_snapshot) ??
            numOrNull(u.cuba_total_cents_snapshot),
          agreedPriceCents: num(u.agreed_price_cents, 0),
        }))
      : base.units,
    extras: dto.extras.map((e, i) => ({
      key: str(e.id) || `extra-${i}`,
      description: str(e.description),
      quantity: num(e.quantity, 1),
      unitAmountCents: num(e.unit_price_cents, 0),
    })),
    cubaRecipient: {
      ...base.cubaRecipient,
      fullName: str(r.full_name),
      identityNumber: str(r.identity_number),
      deliveryAddress: str(r.delivery_address),
      municipality: str(r.municipality),
      province: str(r.province),
      phonePrimary: str(r.primary_phone),
      phoneSecondary: str(r.secondary_phone),
    },
    delivery: {
      method:
        dto.delivery?.method === "HOME_DELIVERY"
          ? "home_delivery"
          : dto.delivery?.method === "PICKUP_POINT"
            ? "pickup_point"
            : null,
      reference: str(dto.delivery?.pickup_reference ?? dto.delivery?.reference),
    },
    allocations: (dto.paymentAllocations ?? []).map((a, i) => ({
      key: str(a.id) || `alloc-${i}`,
      id: str(a.id) || null,
      paymentMethodId: str(a.paymentMethodId),
      planId: a.paymentMethodPlanId ? str(a.paymentMethodPlanId) : null,
      inputMode: a.inputMode === "NET" ? ("NET" as const) : ("GROSS" as const),
      amountCents:
        a.inputMode === "NET"
          ? num(a.netAmountCents, 0)
          : num(a.grossAmountCents, 0),
      reference: str(a.reference),
      notes: str(a.notes),
      methodName: str(a.providerNameSnapshot),
      methodType: (["CARD", "ZELLE", "FINANCING", "INTERNAL"].includes(
        str(a.methodType),
      )
        ? str(a.methodType)
        : "FINANCING") as "CARD" | "ZELLE" | "FINANCING" | "INTERNAL",
      feeStrategy: (
        [
          "NONE",
          "FLAT_RATE",
          "FIXED_AMOUNT",
          "FIXED_PLUS_PERCENT",
          "INSTALLMENTS",
          "CONDITIONAL",
        ].includes(str(a.feeStrategySnapshot))
          ? str(a.feeStrategySnapshot)
          : "NONE"
      ) as CubaSaleFormValues["allocations"][number]["feeStrategy"],
      onlyFlorida: Boolean(a.methodOnlyFlorida),
      planLabel: a.planLabelSnapshot ? str(a.planLabelSnapshot) : null,
    })),
  };

  for (const d of dto.documents ?? []) {
    const doc = readyDocFromUrl(d.signedUrl);
    if (!doc) continue;
    if (d.subjectType === "BUYER" && d.side === "FRONT") next.buyer.documentFront = doc;
    else if (d.subjectType === "BUYER" && d.side === "BACK") next.buyer.documentBack = doc;
    else if (d.subjectType === "CO_BUYER" && d.side === "FRONT" && next.coBuyer)
      next.coBuyer.documentFront = doc;
    else if (d.subjectType === "CO_BUYER" && d.side === "BACK" && next.coBuyer)
      next.coBuyer.documentBack = doc;
    else if (d.subjectType === "CUBA_RECIPIENT" && d.side === "FRONT")
      next.cubaRecipient.documentFront = doc;
    else if (d.subjectType === "CUBA_RECIPIENT" && d.side === "BACK")
      next.cubaRecipient.documentBack = doc;
  }

  return next;
}
