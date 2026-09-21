"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { buildFeeConfig, type PaymentMethodView } from "@/lib/payments/allocation";
import { feeStrategySummary, formatBps } from "@/lib/payments/fee-engine";

/**
 * Elegir con qué se cubre la venta. Las financieras y los medios directos
 * (Zelle, tarjeta, interno) se muestran por separado: no se cotizan igual y el
 * vendedor no debería confundirlos.
 *
 * Toda la configuración (fees, planes, "Solo Florida") sale de la base —
 * `payment_methods` / `payment_method_plans` —, nunca de constantes locales.
 */
export function QuoteMethodDrawer({
  open,
  methods,
  buyerState,
  onClose,
  onPick,
}: {
  open: boolean;
  methods: PaymentMethodView[];
  /** "" = todavía no se sabe dónde está el cliente. */
  buyerState: string;
  onClose: () => void;
  onPick: (method: PaymentMethodView) => void;
}) {
  // Hay decenas de financieras activas: sin buscador, encontrar la correcta en
  // un teléfono es una tortura.
  const [search, setSearch] = useState("");
  const term = search.trim().toLowerCase();
  const visible = term
    ? methods.filter((m) => m.name.toLowerCase().includes(term))
    : methods;

  const state = buyerState.trim().toUpperCase();
  const financing = visible.filter((m) => m.methodType === "FINANCING");
  const direct = visible.filter((m) => m.methodType !== "FINANCING");

  const renderMethod = (m: PaymentMethodView) => {
    const cfg = buildFeeConfig(m, null);
    // Solo se bloquea cuando SABEMOS que el cliente no es de Florida. Si aún
    // no se sabe, se avisa — no se finge que está permitido.
    const blocked = m.onlyFlorida && state !== "" && state !== "FL";
    const unknownState = m.onlyFlorida && state === "";

    return (
      <li key={m.id} className={cn("rounded-xl border border-border bg-surface p-3", blocked && "opacity-60")}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{m.name}</p>
            {m.subtext && (
              <p className="truncate text-[11px] text-muted-foreground">{m.subtext}</p>
            )}
          </div>
          <span className="shrink-0 text-[11px] tabular-nums text-text-secondary">
            {feeStrategySummary(cfg)}
          </span>
        </div>

        {m.plans.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {m.plans.map((p) => (
              <span
                key={p.id}
                className="rounded-full bg-surface-muted px-2 py-0.5 text-[10px] tabular-nums text-muted-foreground"
              >
                {p.label} · {formatBps(p.feeBps)}
              </span>
            ))}
          </div>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {m.onlyFlorida && (
            <span className="rounded-full border border-warning/40 px-2 py-0.5 text-[10px] font-medium text-warning">
              Solo Florida
            </span>
          )}
          {m.requiresSignedContract && (
            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
              Requiere contrato
            </span>
          )}
        </div>

        {unknownState && (
          <p className="mt-2 text-[11px] text-warning">
            Solo para clientes de Florida. Indica el estado del cliente para confirmarlo.
          </p>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          {m.websiteEnabled && m.websiteUrl && (
            <a
              href={m.websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-text-secondary transition-colors hover:text-foreground"
            >
              Abrir solicitud ↗
            </a>
          )}
          <Button
            variant={blocked ? "secondary" : "primary"}
            size="sm"
            disabled={blocked}
            onClick={() => onPick(m)}
          >
            {blocked ? "No disponible (no FL)" : "Simular"}
          </Button>
        </div>
      </li>
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title="Agregar aprobación"
      description="Financieras y medios de pago activos de Smile Motors."
      footer={
        <Button variant="secondary" size="sm" onClick={onClose}>
          Cerrar
        </Button>
      }
    >
      <input
        type="search"
        autoComplete="off"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar financiera o método…"
        aria-label="Buscar método de pago"
        className="mb-3 w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      />

      {visible.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {methods.length === 0
            ? "No hay métodos de pago activos."
            : "Ningún método coincide con la búsqueda."}
        </p>
      ) : (
        <div className="space-y-4">
          {direct.length > 0 && (
            <section>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Pago directo
              </h3>
              <ul className="space-y-2">{direct.map(renderMethod)}</ul>
            </section>
          )}
          {financing.length > 0 && (
            <section>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Financieras
              </h3>
              <ul className="space-y-2">{financing.map(renderMethod)}</ul>
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}
