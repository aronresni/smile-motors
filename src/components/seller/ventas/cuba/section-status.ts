import type { FieldErrors } from "react-hook-form";
import type { CubaSaleFormValues } from "@/lib/sales/schema";
import type { SectionStatus } from "@/components/seller/ventas/cuba/form-section";

export type SectionKey =
  | "header"
  | "commission"
  | "buyer"
  | "coBuyer"
  | "units"
  | "extras"
  | "recipient"
  | "delivery"
  | "notes"
  | "price"
  | "payments";

export const SECTION_DOM_ID: Record<SectionKey, string> = {
  header: "section-header",
  commission: "section-commission",
  buyer: "section-buyer",
  coBuyer: "section-cobuyer",
  units: "section-units",
  extras: "section-extras",
  recipient: "section-recipient",
  delivery: "section-delivery",
  notes: "section-notes",
  price: "section-price",
  payments: "section-payments",
};

const filled = (value?: string | null) => Boolean(value && value.trim());

export function computeSectionStatuses(
  values: CubaSaleFormValues,
  errors: FieldErrors<CubaSaleFormValues>,
): Record<SectionKey, SectionStatus> {
  const buyer = values.buyer;
  const recipient = values.cubaRecipient;

  const buyerComplete =
    Boolean(buyer.documentFront?.dataUrl) &&
    Boolean(buyer.documentBack?.dataUrl) &&
    filled(buyer.firstName) &&
    filled(buyer.lastName) &&
    filled(buyer.documentNumber) &&
    filled(buyer.phone);

  const unitsComplete =
    values.units.length > 0 &&
    values.units.every(
      (u) => filled(u.modelName) && u.agreedPriceCents > 0,
    );

  const recipientComplete =
    filled(recipient.fullName) &&
    filled(recipient.identityNumber) &&
    filled(recipient.deliveryAddress) &&
    filled(recipient.province) &&
    filled(recipient.phonePrimary);

  return {
    header: errors.saleDate
      ? "error"
      : filled(values.saleDate)
        ? "complete"
        : "incomplete",
    commission: "complete",
    buyer: errors.buyer ? "error" : buyerComplete ? "complete" : "incomplete",
    coBuyer: !values.coBuyer
      ? "complete"
      : errors.coBuyer
        ? "error"
        : filled(values.coBuyer.firstName) && filled(values.coBuyer.lastName)
          ? "complete"
          : "incomplete",
    units: errors.units ? "error" : unitsComplete ? "complete" : "incomplete",
    extras: errors.extras ? "error" : "complete",
    recipient: errors.cubaRecipient
      ? "error"
      : recipientComplete
        ? "complete"
        : "incomplete",
    delivery: errors.delivery
      ? "error"
      : values.delivery.method
        ? "complete"
        : "incomplete",
    notes: "complete",
    price: "complete",
    payments: errors.allocations
      ? "error"
      : values.allocations.length > 0
        ? "complete"
        : "incomplete",
  };
}

export function firstErrorSectionId(
  errors: FieldErrors<CubaSaleFormValues>,
): string | null {
  const order: [keyof CubaSaleFormValues, SectionKey][] = [
    ["saleDate", "header"],
    ["buyer", "buyer"],
    ["coBuyer", "coBuyer"],
    ["units", "units"],
    ["extras", "extras"],
    ["cubaRecipient", "recipient"],
    ["delivery", "delivery"],
    ["allocations", "payments"],
  ];
  for (const [key, section] of order) {
    if (errors[key]) return SECTION_DOM_ID[section];
  }
  return null;
}
