"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Controller, useFormContext } from "react-hook-form";
import type { CubaSaleFormValues } from "@/lib/sales/schema";
import type { CatalogModel, CatalogVariant } from "@/lib/sales/catalog";
import { getCatalogModel } from "@/lib/sales/catalog";
import { computeCommission, isPricingConfigured } from "@/lib/commission";
import { formatCents } from "@/lib/money";
import { ROUTES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { ReadOnlyField } from "@/components/ui/form-fields";
import { MoneyField } from "@/components/ui/money-field";
import { SelectMenuField } from "@/components/ui/filter-select";
import { CommissionBreakdownList } from "@/components/commission/commission-breakdown";
import { ModelSearchSelect } from "@/components/seller/ventas/cuba/model-search-select";

interface SaleUnitCardProps {
  index: number;
  canRemove: boolean;
  onRemove: () => void;
}

export function SaleUnitCard({ index, canRemove, onRemove }: SaleUnitCardProps) {
  const {
    control,
    setValue,
    watch,
    formState: { errors },
  } = useFormContext<CubaSaleFormValues>();
  const [open, setOpen] = useState(true);
  const [variants, setVariants] = useState<CatalogVariant[]>([]);

  const unit = watch(`units.${index}`);
  const unitErr = errors.units?.[index];

  // Al rehidratar un borrador guardado tenemos `catalogModelId` pero no la lista
  // de variantes ni el precio fijo / comisión fija: se buscan en el catálogo
  // (sin tocar el precio de venta ya guardado).
  useEffect(() => {
    const id = unit.catalogModelId;
    if (!id || (variants.length > 0 && unit.fixedPriceCents !== undefined)) return;
    let alive = true;
    getCatalogModel(id)
      .then((m) => {
        if (!alive || !m) return;
        if (variants.length === 0) setVariants(m.variants);
        setValue(`units.${index}.fixedPriceCents`, m.fixedPriceCents);
        setValue(`units.${index}.fixedCommissionCents`, m.fixedCommissionCents);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [unit.catalogModelId, unit.fixedPriceCents, variants.length, index, setValue]);

  // Elegir (o cambiar) el producto: el precio de venta se completa con SU
  // precio fijo y la comisión se recalcula con SU configuración.
  const applyModel = (model: CatalogModel | null) => {
    setVariants(model?.variants ?? []);
    setValue(`units.${index}.catalogModelId`, model?.id ?? null, {
      shouldDirty: true,
    });
    setValue(`units.${index}.modelName`, model?.name ?? "", {
      shouldDirty: true,
      shouldValidate: true,
    });
    setValue(
      `units.${index}.listPriceCents`,
      model?.listPriceCents ?? null,
      { shouldDirty: true },
    );
    setValue(`units.${index}.fixedPriceCents`, model ? model.fixedPriceCents : undefined);
    setValue(`units.${index}.fixedCommissionCents`, model ? model.fixedCommissionCents : undefined);
    setValue(
      `units.${index}.agreedPriceCents`,
      model && isPricingConfigured(model.fixedPriceCents, model.fixedCommissionCents) ? model.fixedPriceCents : 0,
      { shouldDirty: true },
    );
    setValue(`units.${index}.variantId`, null, { shouldDirty: true });
    setValue(`units.${index}.variantLabel`, "", { shouldDirty: true });
  };

  const loaded = Boolean(unit.catalogModelId) && unit.fixedPriceCents !== undefined;
  const configured = loaded && isPricingConfigured(unit.fixedPriceCents, unit.fixedCommissionCents);
  const estimate = configured
    ? computeCommission(unit.fixedPriceCents!, unit.fixedCommissionCents!, unit.agreedPriceCents || 0)
    : null;
  // Aviso inmediato (sin esperar al envío): nunca por debajo del precio fijo.
  const belowFixed = estimate != null && unit.agreedPriceCents > 0 && estimate.belowFixedPrice;

  return (
    <div
      className={cn(
        "rounded-xl border bg-surface-muted/40",
        unitErr || belowFixed ? "border-danger/40" : "border-border",
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-surface text-[11px] font-semibold text-text-secondary">
            {index + 1}
          </span>
          <span className="truncate text-sm font-medium text-foreground">
            {unit.modelName || `Unidad ${index + 1}`}
          </span>
          {!unit.modelName && (
            <span className="shrink-0 text-[11px] text-muted-foreground">
              · pendiente
            </span>
          )}
        </button>

        {unit.agreedPriceCents > 0 && (
          <span className="shrink-0 text-xs tabular-nums text-text-secondary">
            {formatCents(unit.agreedPriceCents)}
          </span>
        )}

        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Quitar unidad ${index + 1}`}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-danger hover:bg-danger-surface"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13" />
            </svg>
          </button>
        )}
      </div>

      {open && (
        <div className="grid gap-4 border-t border-border px-3 py-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <ModelSearchSelect
              label="Modelo de vehículo"
              required
              selectedName={unit.modelName}
              onSelect={applyModel}
              error={unitErr?.modelName?.message}
            />
          </div>

          <Controller
            control={control}
            name={`units.${index}.variantId`}
            render={({ field }) => (
              <SelectMenuField
                label="Color / acabado"
                placeholder={
                  unit.modelName
                    ? "Selecciona una variante"
                    : "Selecciona un modelo primero"
                }
                disabled={!unit.modelName || variants.length === 0}
                hint={
                  unit.modelName && variants.length === 0
                    ? "El modelo seleccionado no tiene variantes en el catálogo."
                    : undefined
                }
                options={variants.map((v) => ({ value: v.id, label: v.label }))}
                value={field.value ?? ""}
                onValueChange={(selected) => {
                  const id = selected || null;
                  field.onChange(id);
                  setValue(
                    `units.${index}.variantLabel`,
                    variants.find((v) => v.id === id)?.label ?? "",
                    { shouldDirty: true },
                  );
                }}
              />
            )}
          />

          <ReadOnlyField
            label="Precio fijo de venta"
            value={
              !unit.catalogModelId
                ? "—"
                : !loaded
                  ? "Cargando…"
                  : configured
                    ? formatCents(unit.fixedPriceCents!)
                    : "Sin configurar"
            }
            hint="Precio mínimo oficial, configurado por administración. Puedes vender por encima, nunca por debajo."
          />

          <Controller
            control={control}
            name={`units.${index}.agreedPriceCents`}
            render={({ field, fieldState }) => (
              <MoneyField
                label="Precio de venta"
                required
                valueCents={field.value}
                onChangeCents={field.onChange}
                onBlur={field.onBlur}
                disabled={loaded && !configured}
                error={
                  fieldState.error?.message ??
                  (belowFixed
                    ? `No puede ser inferior al precio fijo (${formatCents(unit.fixedPriceCents!)}).`
                    : undefined)
                }
              />
            )}
          />

          {loaded && !configured && (
            <div
              role="alert"
              className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-xs text-warning sm:col-span-2"
            >
              Este producto todavía no tiene precio fijo de venta o comisión fija. No se puede completar la venta hasta
              que un administrador lo configure en la{" "}
              <Link
                href={`${ROUTES.adminProductos}/${unit.catalogModelId}`}
                className="font-semibold underline underline-offset-2"
              >
                ficha del producto
              </Link>
              .
            </div>
          )}

          {estimate && !belowFixed && unit.agreedPriceCents > 0 && (
            <div className="rounded-lg border border-border bg-surface px-3 py-2.5 sm:col-span-2">
              <p className="mb-2 flex items-baseline justify-between gap-2 text-sm">
                <span className="font-medium text-foreground">Tu comisión estimada</span>
                <strong className="tabular-nums text-success">{formatCents(estimate.finalCommissionCents)}</strong>
              </p>
              <CommissionBreakdownList breakdown={estimate} label={`Comisión estimada · unidad ${index + 1}`} />
              <p className="mt-2 text-[11px] text-muted-foreground">
                Estimada con la configuración vigente del producto; se congela al marcar la venta VENDIDA.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
