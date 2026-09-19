import { z } from "zod";
import { isPricingConfigured } from "@/lib/commission";
import { formatCents } from "@/lib/money";

/* --------------------------------------------------------------------------
 * Documentos
 * ------------------------------------------------------------------------ */
const documentStateSchema = z.object({
  status: z.enum(["idle", "uploading", "editing", "ready", "error"]),
  dataUrl: z.string().nullable(),
  fileName: z.string().nullable(),
  originalDataUrl: z.string().nullable(),
  error: z.string().nullable(),
});

const requiredDocumentSchema = documentStateSchema.refine(
  (d) => Boolean(d.dataUrl),
  { message: "Sube y guarda la imagen del documento." },
);

/* --------------------------------------------------------------------------
 * Comprador
 * ------------------------------------------------------------------------ */
export const buyerSchema = z.object({
  documentFront: requiredDocumentSchema,
  documentBack: requiredDocumentSchema,
  firstName: z.string().trim().min(1, "El nombre es obligatorio"),
  lastName: z.string().trim().min(1, "Los apellidos son obligatorios"),
  dateOfBirth: z.string(),
  documentNumber: z
    .string()
    .trim()
    .min(1, "El N.º de ID / licencia es obligatorio"),
  documentExpiration: z.string(),
  phone: z.string().trim().min(6, "El teléfono es obligatorio"),
  email: z
    .string()
    .trim()
    .email("Correo electrónico inválido")
    .or(z.literal("")),
  addressLine1: z.string().trim(),
  addressLine2: z.string().trim(),
  city: z.string().trim(),
  state: z.string().trim(),
  postalCode: z.string().trim(),
});

/* --------------------------------------------------------------------------
 * Co-buyer (opcional)
 * ------------------------------------------------------------------------ */
export const coBuyerSchema = z.object({
  // Fotos del ID: OPCIONALES — sirven para autocompletar los datos y quedan
  // guardadas con la venta (sale_documents, subject_type = 'CO_BUYER').
  documentFront: documentStateSchema.optional(),
  documentBack: documentStateSchema.optional(),
  firstName: z.string().trim().min(1, "El nombre es obligatorio"),
  lastName: z.string().trim().min(1, "Los apellidos son obligatorios"),
  dateOfBirth: z.string(),
  documentNumber: z.string().trim(),
  phone: z.string().trim(),
  email: z
    .string()
    .trim()
    .email("Correo electrónico inválido")
    .or(z.literal("")),
});

/* --------------------------------------------------------------------------
 * Unidad
 * ------------------------------------------------------------------------ */
export const saleUnitSchema = z.object({
  key: z.string(),
  catalogModelId: z.string().nullable(),
  modelName: z.string().trim().min(1, "Selecciona un modelo del catálogo"),
  variantId: z.string().nullable(),
  variantLabel: z.string().trim(),
  listPriceCents: z.number().int().nonnegative().nullable(),
  /**
   * Precio fijo de venta y comisión fija del producto (solo lectura, del
   * catálogo; no se envían al servidor, que los vuelve a leer). `undefined` =
   * aún no cargados; `null` = el producto no los tiene configurados.
   */
  fixedPriceCents: z.number().int().nullable().optional(),
  fixedCommissionCents: z.number().int().nullable().optional(),
  agreedPriceCents: z
    .number({ invalid_type_error: "Ingresa el precio de venta" })
    .int()
    .positive("El precio de venta debe ser mayor que 0"),
}).superRefine((unit, ctx) => {
  if (!unit.catalogModelId || unit.fixedPriceCents === undefined) return;
  if (!isPricingConfigured(unit.fixedPriceCents, unit.fixedCommissionCents)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["agreedPriceCents"],
      message: "Este producto no tiene precio fijo o comisión fija. Un administrador debe configurarlo.",
    });
  } else if (unit.agreedPriceCents > 0 && unit.agreedPriceCents < unit.fixedPriceCents) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["agreedPriceCents"],
      message: `No puede ser inferior al precio fijo (${formatCents(unit.fixedPriceCents)}).`,
    });
  }
});

/* --------------------------------------------------------------------------
 * Extra
 * ------------------------------------------------------------------------ */
export const saleExtraSchema = z.object({
  key: z.string(),
  description: z.string().trim().min(1, "Describe el extra"),
  quantity: z.number().int().positive("Cantidad mínima 1"),
  unitAmountCents: z.number().int().nonnegative(),
});

/* --------------------------------------------------------------------------
 * Destinatario en Cuba
 * ------------------------------------------------------------------------ */
export const cubaRecipientSchema = z.object({
  documentFront: documentStateSchema,
  documentBack: documentStateSchema,
  fullName: z
    .string()
    .trim()
    .min(1, "El nombre del receptor es obligatorio"),
  identityNumber: z
    .string()
    .trim()
    .min(5, "Ingresa el carné de identidad (CI)"),
  deliveryAddress: z
    .string()
    .trim()
    .min(1, "La dirección de entrega es obligatoria"),
  municipality: z.string().trim(),
  province: z.string().trim().min(1, "Selecciona la provincia"),
  phonePrimary: z
    .string()
    .trim()
    .min(6, "El teléfono principal es obligatorio"),
  phoneSecondary: z.string().trim(),
});

/* --------------------------------------------------------------------------
 * Logística
 * ------------------------------------------------------------------------ */
export const deliverySchema = z
  .object({
    method: z.enum(["home_delivery", "pickup_point"]).nullable(),
    reference: z.string().trim(),
  })
  .superRefine((value, ctx) => {
    if (value.method === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["method"],
        message: "Selecciona un método de entrega",
      });
    }
  });

/* --------------------------------------------------------------------------
 * Liquidación de pagos / financiación (allocations)
 * ------------------------------------------------------------------------ */
export const paymentAllocationSchema = z.object({
  key: z.string(),
  /** id de fila persistida (null si aún no se guardó). */
  id: z.string().nullable(),
  paymentMethodId: z.string().min(1, "Selecciona un método de pago"),
  planId: z.string().nullable(),
  inputMode: z.enum(["GROSS", "NET"]),
  amountCents: z.number().int().nonnegative(),
  reference: z.string().trim(),
  notes: z.string().trim(),
  // desnormalizado para render + validación (no autoritativo):
  methodName: z.string(),
  methodType: z.enum(["CARD", "ZELLE", "FINANCING", "INTERNAL"]),
  feeStrategy: z.enum([
    "NONE",
    "FLAT_RATE",
    "FIXED_AMOUNT",
    "FIXED_PLUS_PERCENT",
    "INSTALLMENTS",
    "CONDITIONAL",
  ]),
  onlyFlorida: z.boolean(),
  planLabel: z.string().nullable(),
});

/* --------------------------------------------------------------------------
 * Venta CUBA completa
 * ------------------------------------------------------------------------ */
export const cubaSaleSchema = z.object({
  operationType: z.literal("cuba"),
  sellerId: z.string().min(1),
  sellerName: z.string().min(1),
  saleDate: z.string().min(1, "La fecha de venta es obligatoria"),
  commissionSharing: z.object({
    enabled: z.boolean(),
    partnerSellerId: z.string().nullable(),
  }),
  buyer: buyerSchema,
  coBuyer: coBuyerSchema.nullable(),
  units: z.array(saleUnitSchema).min(1, "Agrega al menos una unidad"),
  extras: z.array(saleExtraSchema),
  cubaRecipient: cubaRecipientSchema,
  delivery: deliverySchema,
  internalNotes: z.string().trim(),
  allocations: z.array(paymentAllocationSchema),
});

export type CubaSaleFormValues = z.infer<typeof cubaSaleSchema>;
export type BuyerFormValues = z.infer<typeof buyerSchema>;
export type CoBuyerFormValues = z.infer<typeof coBuyerSchema>;
export type SaleUnitFormValues = z.infer<typeof saleUnitSchema>;
export type SaleExtraFormValues = z.infer<typeof saleExtraSchema>;
export type CubaRecipientFormValues = z.infer<typeof cubaRecipientSchema>;
export type PaymentAllocationValues = z.infer<typeof paymentAllocationSchema>;
