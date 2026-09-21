"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ROUTES } from "@/lib/constants";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { MoneyField } from "@/components/ui/money-field";
import { FilterSelect } from "@/components/ui/filter-select";
import { TextField } from "@/components/ui/form-fields";
import { PlusIcon, TrashIcon, PencilIcon, BoxesIcon } from "@/components/ui/icons";
import type { PaymentMethodView } from "@/lib/payments/allocation";
import {
  QUOTE_STORAGE_KEY,
  emptyQuote,
  parseStoredQuote,
  quoteCoverage,
  quoteTotals,
  settleApproval,
  toConversionInput,
  type Quote,
  type QuoteApproval,
  type QuoteLine,
} from "@/lib/sales/quote";
import { ProductThumb } from "@/components/seller/stock/product-thumb";
import { QuoteProductPicker } from "@/components/seller/calculadora/quote-product-picker";
import { QuoteMethodDrawer } from "@/components/seller/calculadora/quote-method-drawer";
import { QuoteApprovalEditor } from "@/components/seller/calculadora/quote-approval-editor";
import {
  convertQuoteToDraft,
  type QuoteRecalculation,
} from "@/app/(seller)/seller/calculadora/actions";

/**
 * CALCULADORA DE VENTA — herramienta de planificación, no una venta.
 *
 * Responde lo único que importa antes de cerrar: cuánto paga el cliente,
 * cuánto descuenta cada financiera y cuánto dinero REAL le queda a Smile
 * Motors. La cobertura se mide SIEMPRE en NETO: $6,000 aprobados no cubren
 * una venta de $5,700 si la financiera se queda con $965.
 *
 * La simulación vive en la pestaña (sessionStorage) y no guarda datos del
 * cliente. Solo al pulsar "Convertir en venta" el servidor recalcula todo y
 * crea un BORRADOR.
 */

const STATE_OPTIONS = [
  { value: "", label: "Sin definir" },
  { value: "FL", label: "Florida" },
  { value: "OTRO", label: "Otro estado" },
];

function SectionCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-3.5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function QuoteCalculator({
  methods,
  initialLine,
}: {
  methods: PaymentMethodView[];
  /** Producto que llega preseleccionado desde el catálogo. */
  initialLine: QuoteLine | null;
}) {
  const router = useRouter();
  const methodsById = useMemo(
    () => Object.fromEntries(methods.map((m) => [m.id, m])),
    [methods],
  );

  const [quote, setQuote] = useState<Quote>(() =>
    initialLine ? { ...emptyQuote(), lines: [initialLine] } : emptyQuote(),
  );
  const [hydrated, setHydrated] = useState(false);

  // Rehidratación desde la pestaña. Se hace tras el montaje (sessionStorage no
  // existe en el servidor) y fuera del render, con el producto preseleccionado
  // añadido al final si aún no estaba.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await Promise.resolve(
        typeof window === "undefined" ? null : window.sessionStorage.getItem(QUOTE_STORAGE_KEY),
      );
      if (cancelled) return;
      const restored = parseStoredQuote(stored);
      setQuote((current) => {
        const base = restored.lines.length || restored.approvals.length ? restored : current;
        if (!initialLine) return base;
        const already = base.lines.some(
          (l) => l.productId === initialLine.productId && l.variantId === initialLine.variantId,
        );
        return already ? base : { ...base, lines: [...base.lines, initialLine] };
      });
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [initialLine]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.sessionStorage.setItem(QUOTE_STORAGE_KEY, JSON.stringify(quote));
    } catch {
      // Modo privado o almacenamiento lleno: la simulación sigue en memoria.
    }
  }, [quote, hydrated]);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editor, setEditor] = useState<{ method: PaymentMethodView | null; key: string | null }>({
    method: null,
    key: null,
  });
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [changed, setChanged] = useState<QuoteRecalculation | null>(null);

  const totals = quoteTotals(quote);
  const coverage = quoteCoverage(quote, methodsById);
  const remaining = coverage.remainingCents;

  const patch = (next: Partial<Quote>) => setQuote((q) => ({ ...q, ...next }));

  const updateLine = (key: string, next: Partial<QuoteLine>) =>
    setQuote((q) => ({
      ...q,
      lines: q.lines.map((l) => (l.key === key ? { ...l, ...next } : l)),
    }));

  const removeLine = (key: string) =>
    setQuote((q) => ({ ...q, lines: q.lines.filter((l) => l.key !== key) }));

  const saveApproval = (value: QuoteApproval) => {
    setQuote((q) => {
      const exists = q.approvals.some((a) => a.key === value.key);
      return {
        ...q,
        approvals: exists
          ? q.approvals.map((a) => (a.key === value.key ? value : a))
          : [...q.approvals, value],
      };
    });
    setEditor({ method: null, key: null });
  };

  const removeApproval = (key: string) =>
    setQuote((q) => ({ ...q, approvals: q.approvals.filter((a) => a.key !== key) }));

  const convert = async (acknowledged = false) => {
    if (busy) return;
    setBusy(true);
    setErrors([]);
    try {
      const result = await convertQuoteToDraft({
        ...toConversionInput(quote),
        expected: { totalCents: totals.totalCents, netCoveredCents: coverage.netCoveredCents },
        acknowledged,
      });
      if (result.ok) {
        try {
          window.sessionStorage.removeItem(QUOTE_STORAGE_KEY);
        } catch {
          // sin almacenamiento: nada que limpiar
        }
        router.push(`${ROUTES.sellerVentas}/${result.saleId}`);
        return;
      }
      if (result.code === "CHANGED") setChanged(result.recalculation);
      else setErrors(result.errors);
    } catch {
      setErrors(["No pudimos convertir la simulación. Intenta de nuevo."]);
    } finally {
      setBusy(false);
    }
  };

  const canConvert = quote.lines.length > 0 && !coverage.hasInvalid;

  /* ------------------------------------------------------------- cobertura */
  const coverageLabel =
    coverage.status === "empty"
      ? "Sin aprobaciones"
      : coverage.status === "exact"
        ? "Venta cubierta"
        : remaining > 0
          ? `Faltan ${formatCents(remaining)}`
          : `Excedente ${formatCents(Math.abs(remaining))}`;

  const coverageTone =
    coverage.status === "exact"
      ? "text-success"
      : coverage.status === "overfunded"
        ? "text-danger"
        : "text-warning";

  return (
    <div className="space-y-4 pb-24 lg:pb-0">
      {/* ------------------------------------------------------- productos */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="min-w-0 space-y-4">
          <SectionCard
            title="Productos"
            action={
              <Button
                variant="secondary"
                size="sm"
                icon={<PlusIcon size={14} />}
                onClick={() => setPickerOpen(true)}
              >
                Agregar producto
              </Button>
            }
          >
            {quote.lines.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
                <p className="text-sm text-text-secondary">
                  Agrega un producto para comenzar la simulación.
                </p>
                <Link
                  href={ROUTES.sellerStock}
                  className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand hover:opacity-80"
                >
                  <BoxesIcon size={14} />
                  Ver el catálogo
                </Link>
              </div>
            ) : (
              <ul className="space-y-2.5">
                {quote.lines.map((line) => (
                  <li
                    key={line.key}
                    className="rounded-xl border border-border bg-surface-muted/40 p-2.5"
                  >
                    <div className="flex gap-3">
                      <ProductThumb
                        src={line.imageUrl}
                        alt={line.productName}
                        sizes="72px"
                        className="h-16 w-20 shrink-0 rounded-lg border border-border"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-foreground">
                          {line.productName}
                        </p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {line.variantLabel ? (
                            <span className="capitalize">{line.variantLabel.toLowerCase()}</span>
                          ) : (
                            "Sin color elegido"
                          )}
                          {line.fixedPriceCents != null && (
                            <span> · mínimo {formatCents(line.fixedPriceCents)}</span>
                          )}
                        </p>
                      </div>
                      <button
                        type="button"
                        aria-label={`Quitar ${line.productName}`}
                        onClick={() => removeLine(line.key)}
                        className="h-8 shrink-0 rounded-lg px-2 text-muted-foreground transition-colors hover:text-danger"
                      >
                        <TrashIcon size={16} />
                      </button>
                    </div>
                    <div className="mt-2">
                      <MoneyField
                        label="Precio pactado"
                        valueCents={line.agreedPriceCents}
                        onChangeCents={(v) => updateLine(line.key, { agreedPriceCents: v })}
                        error={
                          line.fixedPriceCents != null &&
                          line.agreedPriceCents > 0 &&
                          line.agreedPriceCents < line.fixedPriceCents
                            ? `Por debajo del mínimo (${formatCents(line.fixedPriceCents)}).`
                            : undefined
                        }
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {/* Extras: cargos adicionales de la misma operación. */}
            <div className="mt-3 space-y-2">
              {quote.extras.map((extra) => (
                <div key={extra.key} className="flex items-end gap-2">
                  <div className="flex-1">
                    <TextField
                      label="Extra"
                      value={extra.description}
                      onChange={(e) =>
                        setQuote((q) => ({
                          ...q,
                          extras: q.extras.map((x) =>
                            x.key === extra.key ? { ...x, description: e.target.value } : x,
                          ),
                        }))
                      }
                    />
                  </div>
                  <div className="w-32">
                    <MoneyField
                      label="Importe"
                      valueCents={extra.amountCents}
                      onChangeCents={(v) =>
                        setQuote((q) => ({
                          ...q,
                          extras: q.extras.map((x) =>
                            x.key === extra.key ? { ...x, amountCents: v } : x,
                          ),
                        }))
                      }
                    />
                  </div>
                  <button
                    type="button"
                    aria-label="Quitar extra"
                    onClick={() =>
                      setQuote((q) => ({
                        ...q,
                        extras: q.extras.filter((x) => x.key !== extra.key),
                      }))
                    }
                    className="mb-1.5 h-9 rounded-lg px-2 text-muted-foreground transition-colors hover:text-danger"
                  >
                    <TrashIcon size={16} />
                  </button>
                </div>
              ))}
              {quote.lines.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    setQuote((q) => ({
                      ...q,
                      extras: [
                        ...q.extras,
                        { key: crypto.randomUUID(), description: "", amountCents: 0 },
                      ],
                    }))
                  }
                  className="text-xs font-semibold text-brand hover:opacity-80"
                >
                  + Agregar extra
                </button>
              )}
            </div>
          </SectionCard>

          {/* ------------------------------------------------ total a cubrir */}
          <div className="rounded-2xl border border-border bg-surface-muted/40 p-3.5">
            <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Total a cubrir
            </p>
            <p className="mt-0.5 text-2xl font-semibold tabular-nums leading-none text-foreground">
              {formatCents(totals.totalCents)}
            </p>
            {totals.extrasCents > 0 && (
              <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
                Productos {formatCents(totals.unitsCents)} · extras{" "}
                {formatCents(totals.extrasCents)}
              </p>
            )}
          </div>
        </div>

        {/* ----------------------------------------------------- aprobaciones */}
        <div className="min-w-0 space-y-4">
          <SectionCard
            title="Aprobaciones"
            action={
              <Button
                variant="secondary"
                size="sm"
                icon={<PlusIcon size={14} />}
                onClick={() => setDrawerOpen(true)}
              >
                Agregar
              </Button>
            }
          >
            <div className="mb-3">
              <FilterSelect
                label="Estado del cliente"
                ariaLabel="Estado del cliente"
                value={quote.buyerState}
                onValueChange={(v) => patch({ buyerState: v })}
                options={STATE_OPTIONS}
                size="sm"
              />
            </div>

            {quote.approvals.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-text-secondary">
                Agrega una aprobación o método de pago para calcular cuánto falta cubrir.
              </p>
            ) : (
              <ul className="space-y-2">
                {quote.approvals.map((approval) => {
                  const method = methodsById[approval.paymentMethodId];
                  const s = settleApproval(approval, method, quote.buyerState);
                  return (
                    <li
                      key={approval.key}
                      className="rounded-xl border border-border bg-surface-muted/40 p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-foreground">
                            {approval.methodName}
                          </p>
                          <p className="truncate text-[11px] text-muted-foreground">
                            {approval.planLabel ??
                              (approval.methodType === "FINANCING" ? "Sin plazo" : "Pago directo")}
                          </p>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <button
                            type="button"
                            aria-label={`Editar ${approval.methodName}`}
                            onClick={() =>
                              setEditor({ method: method ?? null, key: approval.key })
                            }
                            className="h-8 rounded-lg px-2 text-muted-foreground transition-colors hover:text-foreground"
                          >
                            <PencilIcon size={15} />
                          </button>
                          <button
                            type="button"
                            aria-label={`Quitar ${approval.methodName}`}
                            onClick={() => removeApproval(approval.key)}
                            className="h-8 rounded-lg px-2 text-muted-foreground transition-colors hover:text-danger"
                          >
                            <TrashIcon size={15} />
                          </button>
                        </div>
                      </div>

                      <dl className="mt-2 space-y-1 text-sm">
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">Aprobado (bruto)</dt>
                          <dd className="tabular-nums text-text-secondary">
                            {formatCents(s.grossCents)}
                          </dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">
                            {approval.methodType === "FINANCING"
                              ? "Te quita la financiera"
                              : "Comisión"}
                          </dt>
                          <dd className="tabular-nums text-danger">
                            −{formatCents(s.feeCents)}
                          </dd>
                        </div>
                        <div className="flex justify-between border-t border-border pt-1">
                          <dt className="font-medium text-foreground">Neto líquido</dt>
                          <dd className="tabular-nums font-semibold text-success">
                            {formatCents(s.netCents)}
                          </dd>
                        </div>
                        {s.monthlyCents != null && (
                          <div className="flex justify-between text-xs">
                            <dt className="text-muted-foreground">Cuota mensual estimada</dt>
                            <dd className="tabular-nums text-text-secondary">
                              {formatCents(s.monthlyCents)}
                            </dd>
                          </div>
                        )}
                      </dl>

                      {s.error && <p className="mt-1.5 text-[11px] text-danger">{s.error}</p>}
                      {s.floridaBlocked && (
                        <p className="mt-1.5 text-[11px] text-danger">
                          Solo para clientes de Florida.
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>

          {/* --------------------------------------------------- cobertura */}
          <div
            role="group"
            aria-label="Cobertura de la simulación"
            className="rounded-2xl border border-border bg-surface p-3.5"
          >
            <dl className="grid grid-cols-3 gap-2 text-center">
              <div>
                <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Total a cubrir
                </dt>
                <dd className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
                  {formatCents(totals.totalCents)}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Cubierto (neto)
                </dt>
                <dd className="mt-0.5 text-sm font-semibold tabular-nums text-success">
                  {formatCents(coverage.netCoveredCents)}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {remaining >= 0 ? "Falta" : "Excedente"}
                </dt>
                <dd
                  className={cn(
                    "mt-0.5 text-sm font-semibold tabular-nums",
                    remaining === 0 ? "text-success" : remaining > 0 ? "text-warning" : "text-danger",
                  )}
                >
                  {formatCents(Math.abs(remaining))}
                </dd>
              </div>
            </dl>

            <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-muted">
              <div
                className={cn(
                  "h-full rounded-full transition-[width]",
                  coverage.status === "exact"
                    ? "bg-success"
                    : coverage.status === "overfunded"
                      ? "bg-danger"
                      : "bg-brand",
                )}
                style={{ width: `${Math.min(100, coverage.pct)}%` }}
              />
            </div>
            <div className="mt-1.5 flex items-center justify-between text-xs">
              <span className={cn("font-semibold", coverageTone)}>{coverageLabel}</span>
              <span className="tabular-nums text-muted-foreground">
                {coverage.pct}% ·{" "}
                {quote.approvals.length === 1
                  ? "1 aprobación"
                  : `${quote.approvals.length} aprobaciones`}
              </span>
            </div>
          </div>

          {errors.length > 0 && (
            <ul
              role="alert"
              className="space-y-1 rounded-2xl border border-danger/30 bg-danger-surface px-3.5 py-3 text-xs text-danger"
            >
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}

          <div className="hidden lg:block">
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              disabled={!canConvert}
              loading={busy}
              loadingText="Creando borrador…"
              onClick={() => convert(false)}
            >
              Convertir en venta
            </Button>
          </div>
        </div>
      </div>

      {/* CTA fijo en móvil, respetando el área segura del iPhone. */}
      <div
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border/70 bg-background/95 px-4 pt-2.5 backdrop-blur lg:hidden"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 4.75rem)" }}
      >
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          disabled={!canConvert}
          loading={busy}
          loadingText="Creando borrador…"
          onClick={() => convert(false)}
        >
          Convertir en venta · {formatCents(totals.totalCents)}
        </Button>
      </div>

      <QuoteProductPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onAdd={(line) => {
          setQuote((q) => ({ ...q, lines: [...q.lines, line] }));
          setPickerOpen(false);
        }}
      />

      <QuoteMethodDrawer
        open={drawerOpen}
        methods={methods}
        buyerState={quote.buyerState}
        onClose={() => setDrawerOpen(false)}
        onPick={(method) => {
          setDrawerOpen(false);
          setEditor({ method, key: null });
        }}
      />

      {editor.method && (
        <QuoteApprovalEditor
          key={editor.key ?? editor.method.id}
          open
          method={editor.method}
          initial={quote.approvals.find((a) => a.key === editor.key) ?? null}
          suggestedGrossCents={Math.max(0, remaining)}
          buyerState={quote.buyerState}
          onClose={() => setEditor({ method: null, key: null })}
          onSave={saveApproval}
        />
      )}

      <Modal
        open={changed != null}
        onClose={() => setChanged(null)}
        size="lg"
        title="Las condiciones cambiaron"
        description="Las condiciones cambiaron desde que comenzaste la simulación."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setChanged(null)}>
              Revisar la simulación
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={busy}
              onClick={() => {
                setChanged(null);
                void convert(true);
              }}
            >
              Continuar con los valores actuales
            </Button>
          </>
        }
      >
        {changed && (
          <div className="space-y-3">
            <ul className="space-y-1 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2.5 text-xs text-warning">
              {changed.changes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <dl className="space-y-1 rounded-xl border border-border bg-surface-muted/50 px-3 py-2.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Total a cubrir</dt>
                <dd className="tabular-nums text-text-secondary">
                  {formatCents(changed.totalCents)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Cubierto (neto)</dt>
                <dd className="tabular-nums text-text-secondary">
                  {formatCents(changed.netCoveredCents)}
                </dd>
              </div>
              <div className="flex justify-between border-t border-border pt-1">
                <dt className="font-medium text-foreground">
                  {changed.remainingCents >= 0 ? "Falta" : "Excedente"}
                </dt>
                <dd className="tabular-nums font-semibold text-foreground">
                  {formatCents(Math.abs(changed.remainingCents))}
                </dd>
              </div>
            </dl>
          </div>
        )}
      </Modal>
    </div>
  );
}
