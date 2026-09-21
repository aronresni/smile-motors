"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { MoneyField } from "@/components/ui/money-field";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { isPricingConfigured } from "@/lib/commission";
import { searchCatalog, type CatalogModel } from "@/lib/sales/catalog";
import { swatchFor } from "@/components/seller/stock/variant-colors";
import type { QuoteLine } from "@/lib/sales/quote";

/**
 * Selector de producto de la calculadora. Usa EXACTAMENTE el mismo servicio de
 * catálogo que el formulario de venta (`searchCatalog`), así que no hay una
 * segunda lista de productos que se pueda quedar vieja.
 */
export function QuoteProductPicker({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (line: QuoteLine) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState<CatalogModel | null>(null);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [agreedPriceCents, setAgreedPriceCents] = useState(0);
  const reqRef = useRef(0);

  useEffect(() => {
    if (!open || model) return;
    const reqId = ++reqRef.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const rows = await searchCatalog(query);
        if (reqRef.current === reqId) setResults(rows);
      } catch {
        if (reqRef.current === reqId) setResults([]);
      } finally {
        if (reqRef.current === reqId) setLoading(false);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [query, open, model]);

  const reset = () => {
    setModel(null);
    setVariantId(null);
    setAgreedPriceCents(0);
    setQuery("");
  };

  const close = () => {
    reset();
    onClose();
  };

  const pick = (m: CatalogModel) => {
    setModel(m);
    setVariantId(m.variants.length === 1 ? m.variants[0].id : null);
    // Arranca en el precio mínimo oficial: es el punto de partida real de
    // cualquier negociación.
    setAgreedPriceCents(m.fixedPriceCents ?? 0);
  };

  const belowMinimum =
    model != null &&
    model.fixedPriceCents != null &&
    agreedPriceCents > 0 &&
    agreedPriceCents < model.fixedPriceCents;

  const canAdd = model != null && agreedPriceCents > 0 && !belowMinimum;

  const add = () => {
    if (!model || !canAdd) return;
    const variant = model.variants.find((v) => v.id === variantId) ?? null;
    onAdd({
      key: crypto.randomUUID(),
      productId: model.id,
      variantId: variant?.id ?? null,
      productName: model.name,
      variantLabel: variant?.label ?? null,
      listPriceCents: model.listPriceCents || null,
      fixedPriceCents: model.fixedPriceCents,
      fixedCommissionCents: model.fixedCommissionCents,
      imageUrl: model.imageUrl,
      agreedPriceCents,
    });
    reset();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      size="lg"
      title={model ? model.name : "Agregar producto"}
      description={
        model
          ? [model.brand, model.displacement].filter(Boolean).join(" · ")
          : "Busca en el catálogo por modelo o marca."
      }
      footer={
        model ? (
          <>
            <Button variant="secondary" size="sm" onClick={reset}>
              Cambiar producto
            </Button>
            <Button variant="primary" size="sm" onClick={add} disabled={!canAdd}>
              Agregar a la simulación
            </Button>
          </>
        ) : (
          <Button variant="secondary" size="sm" onClick={close}>
            Cerrar
          </Button>
        )
      }
    >
      {!model ? (
        <div className="space-y-2">
          <input
            type="search"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por modelo o marca…"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          />
          {loading ? (
            <p className="py-6 text-center text-xs text-muted-foreground">Buscando…</p>
          ) : results.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No encontramos productos con estos filtros.
            </p>
          ) : (
            <ul className="max-h-[48vh] space-y-1.5 overflow-y-auto">
              {results.map((m) => {
                const sellable = isPricingConfigured(m.fixedPriceCents, m.fixedCommissionCents);
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      disabled={!sellable}
                      onClick={() => pick(m)}
                      className={cn(
                        "flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-surface px-3 py-2.5 text-left transition-colors",
                        sellable
                          ? "hover:border-border-strong hover:bg-surface-muted"
                          : "opacity-55",
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-foreground">
                          {m.name}
                        </span>
                        <span className="block truncate text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                          {[m.brand, m.category].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        {sellable ? (
                          <span className="block text-sm font-semibold tabular-nums text-brand">
                            {formatCents(m.fixedPriceCents ?? 0)}
                          </span>
                        ) : (
                          <span className="block text-[11px] text-muted-foreground">
                            Sin precio configurado
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {model.variants.length > 0 && (
            <fieldset className="space-y-1.5">
              <legend className="text-xs font-medium text-text-secondary">
                Color (opcional)
              </legend>
              <ul className="flex flex-wrap gap-1.5">
                {model.variants.map((v) => {
                  const color = swatchFor(v.label);
                  const active = variantId === v.id;
                  return (
                    <li key={v.id}>
                      <button
                        type="button"
                        aria-pressed={active}
                        onClick={() => setVariantId(active ? null : v.id)}
                        className={cn(
                          "flex items-center gap-1.5 rounded-full border py-1 pl-1.5 pr-2.5 text-[11px] font-medium capitalize transition-colors",
                          active
                            ? "border-brand bg-brand-soft text-foreground"
                            : "border-border bg-surface-muted text-text-secondary hover:text-foreground",
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            "h-3.5 w-3.5 rounded-full border",
                            color
                              ? "border-white/25"
                              : "border-dashed border-muted-foreground/60",
                          )}
                          style={color ? { backgroundColor: color } : undefined}
                        />
                        {v.label.toLowerCase()}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          )}

          <MoneyField
            label="Precio pactado"
            valueCents={agreedPriceCents}
            onChangeCents={setAgreedPriceCents}
            required
            error={
              belowMinimum
                ? `No puede ser inferior al precio mínimo (${formatCents(model.fixedPriceCents ?? 0)}).`
                : undefined
            }
            hint={
              model.fixedPriceCents != null
                ? `Precio mínimo oficial: ${formatCents(model.fixedPriceCents)}`
                : undefined
            }
          />
        </div>
      )}
    </Modal>
  );
}
