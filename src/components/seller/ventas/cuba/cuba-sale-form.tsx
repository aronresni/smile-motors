"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FormProvider, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { cubaSaleSchema, type CubaSaleFormValues } from "@/lib/sales/schema";
import { emptyDocument } from "@/lib/sales/types";
import { formatCents } from "@/lib/money";
import { ROUTES } from "@/lib/constants";
import { createClient } from "@/lib/supabase/client";
import {
  hydrateFormValues,
  toDraftPayload,
  type CubaSaleDraftDto,
} from "@/lib/sales/draft-transport";
import {
  createCubaSaleDraft,
  recordSaleDocumentMeta,
  removeSaleDocumentMeta,
  saveCubaSaleDraft,
  type DocSide,
  type DocSubject,
} from "@/app/(seller)/seller/ventas/draft-actions";
import { useUnsavedChangesWarning } from "@/hooks/use-unsaved-changes-warning";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { FormSection } from "@/components/seller/ventas/cuba/form-section";
import {
  computeSectionStatuses,
  firstErrorSectionId,
} from "@/components/seller/ventas/cuba/section-status";
import { makeEmptyUnit } from "@/components/seller/ventas/cuba/sale-units-section";
import { SaleHeaderSection } from "@/components/seller/ventas/cuba/sale-header-section";
import { CommissionSharingSection } from "@/components/seller/ventas/cuba/commission-sharing-section";
import { BuyerSection } from "@/components/seller/ventas/cuba/buyer-section";
import { CoBuyerSection } from "@/components/seller/ventas/cuba/co-buyer-section";
import { SaleUnitsSection } from "@/components/seller/ventas/cuba/sale-units-section";
import { ExtrasSection } from "@/components/seller/ventas/cuba/extras-section";
import { CubaRecipientSection } from "@/components/seller/ventas/cuba/cuba-recipient-section";
import { DeliverySection } from "@/components/seller/ventas/cuba/delivery-section";
import { InternalNotesSection } from "@/components/seller/ventas/cuba/internal-notes-section";
import { PriceSummarySection } from "@/components/seller/ventas/cuba/price-summary-section";
import { LiquidationSection } from "@/components/seller/ventas/cuba/liquidation-section";
import { SaleSummary } from "@/components/seller/ventas/cuba/sale-summary";
import { SaleActions } from "@/components/seller/ventas/cuba/sale-actions";
import {
  canProceedToReview,
  summarizeCoverage,
  type PaymentMethodView,
} from "@/lib/payments/allocation";
import { computeSaleTotalCents } from "@/components/seller/ventas/cuba/price-summary-section";

interface CubaSaleFormProps {
  sellerId: string;
  sellerName: string;
  defaultSaleDate: string; // ISO yyyy-mm-dd calculado en el servidor
  /** Catálogo de métodos de pago activos (cargado en el servidor). */
  paymentMethods: PaymentMethodView[];
  /** Si se edita un borrador existente. */
  initialSaleId?: string;
  initialDraft?: CubaSaleDraftDto;
  /**
   * Unidad que llega preseleccionada desde el catálogo o la calculadora. El
   * servidor ya validó que el producto y la variante siguen activos; aquí solo
   * se usa como valor inicial del formulario (y se vuelve a validar al
   * guardar, en `save_cuba_sale_draft`).
   */
  prefillUnit?: PrefillUnit;
}

/** Unidad prellenada (producto ya verificado en el servidor). */
export interface PrefillUnit {
  catalogModelId: string;
  modelName: string;
  variantId: string | null;
  variantLabel: string;
  listPriceCents: number | null;
  fixedPriceCents: number | null;
  fixedCommissionCents: number | null;
  agreedPriceCents: number;
}

interface DocSlot {
  subject: DocSubject;
  side: DocSide;
  subpath: string;
  formPath: (v: CubaSaleFormValues) => string | null;
}

const DOC_SLOTS: DocSlot[] = [
  {
    subject: "BUYER",
    side: "FRONT",
    subpath: "buyer/front.jpg",
    formPath: (v) => v.buyer.documentFront.dataUrl,
  },
  {
    subject: "BUYER",
    side: "BACK",
    subpath: "buyer/back.jpg",
    formPath: (v) => v.buyer.documentBack.dataUrl,
  },
  {
    subject: "CO_BUYER",
    side: "FRONT",
    subpath: "co-buyer/front.jpg",
    formPath: (v) => v.coBuyer?.documentFront?.dataUrl ?? null,
  },
  {
    subject: "CO_BUYER",
    side: "BACK",
    subpath: "co-buyer/back.jpg",
    formPath: (v) => v.coBuyer?.documentBack?.dataUrl ?? null,
  },
  {
    subject: "CUBA_RECIPIENT",
    side: "FRONT",
    subpath: "recipient/front.jpg",
    formPath: (v) => v.cubaRecipient.documentFront.dataUrl,
  },
  {
    subject: "CUBA_RECIPIENT",
    side: "BACK",
    subpath: "recipient/back.jpg",
    formPath: (v) => v.cubaRecipient.documentBack.dataUrl,
  },
];

function buildDefaults(
  sellerId: string,
  sellerName: string,
  saleDate: string,
  prefillUnit?: PrefillUnit,
): CubaSaleFormValues {
  return {
    operationType: "cuba",
    sellerId,
    sellerName,
    saleDate,
    commissionSharing: { enabled: false, partnerSellerId: null },
    buyer: {
      documentFront: emptyDocument(),
      documentBack: emptyDocument(),
      firstName: "",
      lastName: "",
      dateOfBirth: "",
      documentNumber: "",
      documentExpiration: "",
      phone: "",
      email: "",
      addressLine1: "",
      addressLine2: "",
      city: "",
      state: "",
      postalCode: "",
    },
    coBuyer: null,
    units: [
      prefillUnit
        ? { ...makeEmptyUnit("unit-initial"), ...prefillUnit }
        : makeEmptyUnit("unit-initial"),
    ],
    extras: [],
    cubaRecipient: {
      documentFront: emptyDocument(),
      documentBack: emptyDocument(),
      fullName: "",
      identityNumber: "",
      deliveryAddress: "",
      municipality: "",
      province: "",
      phonePrimary: "",
      phoneSecondary: "",
    },
    delivery: { method: null, reference: "" },
    internalNotes: "",
    allocations: [],
  };
}

export function CubaSaleForm({
  sellerId,
  sellerName,
  defaultSaleDate,
  paymentMethods,
  initialSaleId,
  initialDraft,
  prefillUnit,
}: CubaSaleFormProps) {
  const router = useRouter();
  const methodsById = useMemo(
    () => Object.fromEntries(paymentMethods.map((m) => [m.id, m])),
    [paymentMethods],
  );

  const methods = useForm<CubaSaleFormValues>({
    resolver: zodResolver(cubaSaleSchema),
    defaultValues: initialDraft
      ? hydrateFormValues(
          buildDefaults(sellerId, sellerName, defaultSaleDate),
          initialDraft,
        )
      : buildDefaults(sellerId, sellerName, defaultSaleDate, prefillUnit),
    mode: "onSubmit",
    reValidateMode: "onChange",
  });

  const {
    handleSubmit,
    control,
    reset,
    getValues,
    formState: { errors, isDirty, isSubmitting },
  } = methods;

  const [discardOpen, setDiscardOpen] = useState(false);
  const [saleId, setSaleId] = useState<string | null>(initialSaleId ?? null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [coverageError, setCoverageError] = useState<string | null>(null);
  // Slots ya persistidos (para poder detectar "quitar" tras recargar).
  const uploadedRef = useRef<Record<string, string>>(
    Object.fromEntries(
      (initialDraft?.documents ?? []).map((d) => [
        `${d.subjectType}:${d.side}`,
        "__persisted__",
      ]),
    ),
  );

  useUnsavedChangesWarning(isDirty && !savingDraft && !isSubmitting);

  // Sincroniza los documentos con Storage privado: sube los nuevos/cambiados y
  // elimina los que el vendedor quitó. Best-effort, no bloquea el guardado.
  const syncDocuments = useCallback(
    async (currentSaleId: string) => {
      const supabase = createClient();
      const v = getValues();
      for (const { subject, side, subpath, formPath } of DOC_SLOTS) {
        const key = `${subject}:${side}`;
        const dataUrl = formPath(v);
        const storagePath = `${sellerId}/${currentSaleId}/${subpath}`;
        try {
          if (!dataUrl || dataUrl.startsWith("http")) {
            // vacío (o ya es una URL firmada del recargado): si antes lo subimos, quitarlo
            if (!dataUrl && uploadedRef.current[key]) {
              await supabase.storage.from("sale-documents").remove([storagePath]);
              await removeSaleDocumentMeta(currentSaleId, subject, side);
              delete uploadedRef.current[key];
            }
            continue;
          }
          if (uploadedRef.current[key] === dataUrl) continue; // sin cambios
          const blob = await (await fetch(dataUrl)).blob();
          const { error } = await supabase.storage
            .from("sale-documents")
            .upload(storagePath, blob, {
              upsert: true, // reemplaza el mismo objeto: sin huérfanos ni duplicados
              contentType: blob.type || "image/jpeg",
            });
          if (error) continue; // silencioso, sin PII
          uploadedRef.current[key] = dataUrl;
          await recordSaleDocumentMeta(
            currentSaleId,
            subject,
            side,
            storagePath,
            blob.type || "image/jpeg",
            blob.size,
          );
        } catch {
          // sin exponer detalles
        }
      }
    },
    [getValues, sellerId],
  );

  /** Persiste el borrador (creándolo si hace falta) y devuelve el saleId. */
  const persistDraft = useCallback(async (): Promise<string | null> => {
    let id = saleId;
    if (!id) {
      const created = await createCubaSaleDraft();
      if ("error" in created) {
        setSaveError(created.error);
        return null;
      }
      id = created.saleId;
      setSaleId(id);
      window.history.replaceState(null, "", `${ROUTES.sellerVentas}/${id}`);
    }
    const result = await saveCubaSaleDraft(id, toDraftPayload(getValues()));
    if ("error" in result) {
      setSaveError(result.error);
      return null;
    }
    methods.reset(getValues()); // limpia el estado "sin guardar"
    void syncDocuments(id);
    return id;
  }, [saleId, getValues, methods, syncDocuments]);

  const saveDraft = useCallback(async () => {
    if (savingDraft) return;
    setSavingDraft(true);
    setSaveError(null);
    try {
      const id = await persistDraft();
      if (!id) return;
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 2500);
    } catch {
      setSaveError("No se pudo guardar el borrador.");
    } finally {
      setSavingDraft(false);
    }
  }, [savingDraft, persistDraft]);

  const values = useWatch({ control }) as CubaSaleFormValues;
  const statuses = useMemo(
    () => computeSectionStatuses(values, errors),
    [values, errors],
  );

  // "Continuar a revisión": exige liquidación EXACTA (Σ neto = total), guarda el
  // borrador y navega a la revisión respaldada por base de datos. La regla se
  // revalida de forma autoritativa en el backend al confirmar.
  const onValid = useCallback(async () => {
    const v = getValues();
    const saleTotal = computeSaleTotalCents(v).totalCents;
    const coverage = summarizeCoverage(v.allocations, saleTotal, methodsById);
    if (!canProceedToReview(coverage)) {
      const msg =
        coverage.status === "empty"
          ? "No has seleccionado un método de pago."
          : coverage.hasInvalid
            ? "Hay un pago con configuración incompleta (revisa el plazo)."
            : coverage.remainingCents > 0
              ? `Faltan ${formatCents(coverage.remainingCents)} por cubrir.`
              : `La liquidación supera el total de la venta por ${formatCents(
                  -coverage.remainingCents,
                )}.`;
      setCoverageError(msg);
      document
        .getElementById("section-payments")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    setCoverageError(null);
    const id = await persistDraft();
    if (!id) return;
    router.push(`${ROUTES.sellerVentas}/${id}/revision`);
  }, [getValues, methodsById, persistDraft, router]);

  const onInvalid = useCallback(() => {
    const id = firstErrorSectionId(errors);
    if (!id) return;
    const el = document.getElementById(id);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => {
      el?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus();
    }, 350);
  }, [errors]);


  return (
    <FormProvider {...methods}>
      {savedFlash && (
        <div
          role="status"
          className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-full border border-success/30 bg-success/15 px-4 py-1.5 text-xs font-medium text-success shadow-lg"
        >
          Venta guardada
        </div>
      )}

      <div className="mb-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">
          {saleId ? "Borrador de venta · Cuba" : "Nueva venta · Cuba"}
        </p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          Registrar venta
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Operación con destino a Cuba. Completa las secciones y continúa a
          revisión.
        </p>
      </div>

      <form
        onSubmit={(e) => { void handleSubmit(onValid, onInvalid)(e); }}
        className="lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-6"
      >
        <div className="min-w-0 space-y-4">
          <FormSection
            id="section-header"
            index={1}
            title="Datos de la venta"
            description="Vendedor y fecha"
            status={statuses.header}
          >
            <SaleHeaderSection />
          </FormSection>

          <FormSection
            id="section-commission"
            title="Compartir comisión"
            status={statuses.commission}
            defaultOpen={false}
          >
            <CommissionSharingSection />
          </FormSection>

          <FormSection
            id="section-buyer"
            index={2}
            title="Información del comprador"
            description="Documentos, datos personales y dirección"
            status={statuses.buyer}
          >
            <BuyerSection />
          </FormSection>

          <FormSection
            id="section-cobuyer"
            title="Co-buyer"
            description="Segundo titular (opcional)"
            status={statuses.coBuyer}
            defaultOpen={false}
          >
            <CoBuyerSection />
          </FormSection>

          <FormSection
            id="section-units"
            index={3}
            title="Unidades en el pedido"
            description="Modelos, variantes y precio de venta"
            status={statuses.units}
          >
            <SaleUnitsSection />
          </FormSection>

          <FormSection
            id="section-extras"
            title="Extras"
            description="Cargos adicionales (opcional)"
            status={statuses.extras}
            defaultOpen={false}
          >
            <ExtrasSection />
          </FormSection>

          <FormSection
            id="section-recipient"
            index={4}
            title="Destinatario en Cuba"
            description="Persona que recibe el producto"
            status={statuses.recipient}
          >
            <CubaRecipientSection />
          </FormSection>

          <FormSection
            id="section-delivery"
            index={5}
            title="Entrega / logística"
            status={statuses.delivery}
          >
            <DeliverySection />
          </FormSection>

          <FormSection
            id="section-notes"
            title="Notas internas"
            status={statuses.notes}
            defaultOpen={false}
          >
            <InternalNotesSection />
          </FormSection>

          <FormSection
            id="section-price"
            index={6}
            title="Resumen del precio"
            description="Total autoritativo de la operación"
            status={statuses.price}
          >
            <PriceSummarySection />
          </FormSection>

          <FormSection
            id="section-payments"
            index={7}
            title="Liquidación y pagos"
            description="La cobertura NETA debe igualar el total de la venta"
            status={statuses.payments}
          >
            <LiquidationSection
              methods={paymentMethods}
              methodsById={methodsById}
            />
          </FormSection>

          <div className="lg:hidden">
            <SaleSummary variant="inline" methodsById={methodsById} />
          </div>

          {(saveError || coverageError) && (
            <p
              role="alert"
              className="rounded-lg border border-danger/30 bg-danger-surface px-3.5 py-2.5 text-sm text-danger"
            >
              {saveError ?? coverageError}
            </p>
          )}

          <SaleActions
            continuing={isSubmitting}
            savingDraft={savingDraft}
            onDiscard={() => setDiscardOpen(true)}
            onSaveDraft={saveDraft}
          />
        </div>

        <aside className="hidden lg:block">
          <div className="sticky top-20">
            <SaleSummary variant="panel" methodsById={methodsById} />
          </div>
        </aside>
      </form>

      <Modal
        open={discardOpen}
        onClose={() => setDiscardOpen(false)}
        title="Descartar venta"
        description="Se perderán los datos ingresados en este formulario."
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setDiscardOpen(false)}
            >
              Seguir editando
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                reset();
                setDiscardOpen(false);
                router.push(ROUTES.sellerVentaNueva);
              }}
            >
              Descartar
            </Button>
          </>
        }
      >
        <p className="text-sm text-text-secondary">
          ¿Seguro que quieres descartar esta venta y volver a la selección de
          operación?
        </p>
      </Modal>
    </FormProvider>
  );
}
