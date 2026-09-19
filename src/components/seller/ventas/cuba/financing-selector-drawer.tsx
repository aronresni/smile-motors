"use client";

import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { buildFeeConfig, type PaymentMethodView } from "@/lib/payments/allocation";
import { feeStrategySummary, formatBps } from "@/lib/payments/fee-engine";

interface Props {
  open: boolean;
  methods: PaymentMethodView[];
  buyerState: string;
  onClose: () => void;
  onPick: (method: PaymentMethodView) => void;
}

/**
 * "Gestionar financieras" — selector de proveedor de financiación disponible.
 * No integra APIs de proveedores: el vendedor abre la solicitud externa,
 * regresa y registra el importe aprobado.
 */
export function FinancingSelectorDrawer({
  open,
  methods,
  buyerState,
  onClose,
  onPick,
}: Props) {
  const financing = methods.filter((m) => m.methodType === "FINANCING");
  const isFL = buyerState.toUpperCase() === "FL";

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title="Financieras disponibles"
      description="Selecciona un proveedor para registrar un pago financiado."
      footer={
        <Button variant="secondary" size="sm" onClick={onClose}>
          Cerrar
        </Button>
      }
    >
      {financing.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No hay financieras activas para esta sucursal.
        </p>
      ) : (
        <ul className="space-y-2">
          {financing.map((m) => {
            const cfg = buildFeeConfig(m, null);
            const blocked = m.onlyFlorida && !isFL;
            return (
              <li
                key={m.id}
                className={cn(
                  "rounded-xl border border-border bg-surface p-3",
                  blocked && "opacity-60",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {m.name}
                    </p>
                    {m.subtext && (
                      <p className="truncate text-[11px] text-muted-foreground">
                        {m.subtext}
                      </p>
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
                  {m.hasQueue && (
                    <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                      Con cola
                    </span>
                  )}
                </div>

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
                    {blocked ? "No disponible (no FL)" : "Registrar pago"}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
