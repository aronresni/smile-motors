"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { ConfirmedSalePayment } from "@/lib/sales/confirmed-sale";
import {
  attachFinancingContractDocument,
  markFinancingAccredited,
  markFinancingSent,
  markFinancingSigned,
} from "@/app/(seller)/seller/ventas/[saleId]/sale-actions";
import { toast } from "@/components/ui/toast";

const STEP_LABELS = ["ENVIADO", "FIRMADO", "ACREDITADO"] as const;

function formatWhen(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("es-DO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

function Step({
  label,
  done,
  when,
  who,
  active,
}: {
  label: string;
  done: boolean;
  when: string | null;
  who: string | null;
  active: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span
        className={cn(
          "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px] font-bold",
          done
            ? "border-success bg-success/15 text-success"
            : active
              ? "border-accent text-accent"
              : "border-border text-muted-foreground",
        )}
      >
        {done ? "✓" : "○"}
      </span>
      <div className="min-w-0">
        <p
          className={cn(
            "text-xs font-semibold",
            done ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {label}
        </p>
        {when && (
          <p className="text-[11px] text-muted-foreground">
            {formatWhen(when)}
            {who ? ` · ${who}` : ""}
          </p>
        )}
      </div>
    </div>
  );
}

function FinancingContractCard({
  saleId,
  sellerId,
  payment,
  isAdmin,
  isOwner,
}: {
  saleId: string;
  sellerId: string;
  payment: ConfirmedSalePayment;
  isAdmin: boolean;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const contract = payment.financingContract;

  const run = async (fn: () => Promise<{ ok: boolean; code?: string }>, success?: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await fn();
    if (!res.ok) {
      setError(
        res.code === "NOT_ADMIN"
          ? "Solo un administrador puede realizar esta acción."
          : res.code === "NOT_OWNER"
            ? "No tienes permiso para esta acción."
            : "No se pudo completar la acción.",
      );
      setBusy(false);
      return;
    }
    if (success) toast.success(success);
    router.refresh();
  };

  const uploadDocument = async (file: File) => {
    if (!contract) return;
    setBusy(true);
    setError(null);
    try {
      const ext = file.name.split(".").pop() || "pdf";
      const storagePath = `${sellerId}/${saleId}/${contract.id}/contract.${ext}`;
      const supabase = createClient();
      const { error: upErr } = await supabase.storage
        .from("sale-financing-contracts")
        .upload(storagePath, file, { upsert: true, contentType: file.type || undefined });
      if (upErr) throw upErr;
      const res = await attachFinancingContractDocument(
        saleId,
        contract.id,
        storagePath,
        file.type || null,
        file.size,
      );
      if (!res.ok) throw new Error("attach failed");
      toast.success("Documento del contrato subido.");
      router.refresh();
    } catch {
      setError("No se pudo adjuntar el documento.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-xl border border-border bg-surface p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">
            {payment.providerName}
            {payment.planLabel ? (
              <span className="text-muted-foreground"> · {payment.planLabel}</span>
            ) : null}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Bruto {formatCents(payment.grossCents)} · Fee {formatCents(payment.feeCents)} · Neto{" "}
            <span className="font-medium text-text-secondary">
              {formatCents(payment.netCents)}
            </span>
          </p>
        </div>
        {contract?.contractSignedUrl && (
          <a
            href={contract.contractSignedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-xs font-medium text-accent hover:opacity-80"
          >
            Ver contrato ↗
          </a>
        )}
      </div>

      {!contract ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-border px-2.5 py-0.5 text-[11px] text-muted-foreground">
            Sin contrato todavía
          </span>
          {isAdmin && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(() => markFinancingSent(saleId, payment.allocationId), "Contrato marcado como enviado.")
              }
              className="rounded-lg border border-accent/40 px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent/10 disabled:opacity-50"
            >
              Marcar enviado
            </button>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-2.5 border-t border-border pt-3">
          <Step
            label={STEP_LABELS[0]}
            done
            when={contract.sentAt}
            who={contract.sentByName}
            active={false}
          />
          <Step
            label={STEP_LABELS[1]}
            done={contract.status === "SIGNED" || contract.status === "ACCREDITED"}
            when={contract.signedAt}
            who={contract.signedByName}
            active={contract.status === "SENT"}
          />
          <Step
            label={STEP_LABELS[2]}
            done={contract.status === "ACCREDITED"}
            when={contract.accreditedAt}
            who={contract.accreditedByName}
            active={contract.status === "SIGNED"}
          />

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {contract.status === "SENT" && (isOwner || isAdmin) && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(() => markFinancingSigned(saleId, contract.id), "Contrato marcado como firmado.")
                }
                className="rounded-lg border border-accent/40 px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent/10 disabled:opacity-50"
              >
                Marcar firmado
              </button>
            )}
            {contract.status === "SIGNED" && isAdmin && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(() => markFinancingAccredited(saleId, contract.id), "Contrato acreditado.")
                }
                className="rounded-lg border border-success/40 px-2.5 py-1 text-xs font-medium text-success hover:bg-success/10 disabled:opacity-50"
              >
                Marcar acreditado
              </button>
            )}
            {(isOwner || isAdmin) && (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/pdf,image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void uploadDocument(f);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => fileRef.current?.click()}
                  className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-text-secondary hover:text-foreground disabled:opacity-50"
                >
                  {contract.contractSignedUrl ? "Reemplazar documento" : "Adjuntar documento"}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-[11px] text-danger">{error}</p>}
    </li>
  );
}

export function FinancingContractsSection({
  saleId,
  sellerId,
  payments,
  isAdmin,
  isOwner,
}: {
  saleId: string;
  sellerId: string;
  payments: ConfirmedSalePayment[];
  isAdmin: boolean;
  isOwner: boolean;
}) {
  const financing = payments.filter((p) => p.methodType === "FINANCING");
  if (financing.length === 0) return null;

  const allAccredited = financing.every(
    (p) => p.financingContract?.status === "ACCREDITED",
  );

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          📄 Contratos de financieras
        </h2>
        {allAccredited && (
          <span className="rounded-full border border-success/30 bg-success/10 px-2.5 py-0.5 text-[11px] font-semibold text-success">
            Financiación completa
          </span>
        )}
      </div>
      <ul className="space-y-2.5">
        {financing.map((p) => (
          <FinancingContractCard
            key={p.allocationId}
            saleId={saleId}
            sellerId={sellerId}
            payment={p}
            isAdmin={isAdmin}
            isOwner={isOwner}
          />
        ))}
      </ul>
    </div>
  );
}
