"use client";

import { useEffect, useRef, useState } from "react";
import { searchCatalog, type CatalogModel } from "@/lib/sales/catalog";
import { FieldShell } from "@/components/ui/form-fields";
import { formatCents } from "@/lib/money";
import { isPricingConfigured } from "@/lib/commission";

const EMPTY_MESSAGE = "Sin resultados en el catálogo.";

interface ModelSearchSelectProps {
  label: string;
  required?: boolean;
  selectedName: string;
  onSelect: (model: CatalogModel | null) => void;
  error?: string;
}

export function ModelSearchSelect({
  label,
  required,
  selectedName,
  onSelect,
  error,
}: ModelSearchSelectProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<CatalogModel[]>([]);
  const [loading, setLoading] = useState(false);
  const reqRef = useRef(0);

  useEffect(() => {
    if (!open) return;
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
  }, [query, open]);

  if (selectedName) {
    return (
      <FieldShell label={label} required={required} error={error}>
        <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm">
          <span className="truncate text-foreground">{selectedName}</span>
          <button
            type="button"
            onClick={() => {
              onSelect(null);
              setQuery("");
            }}
            className="shrink-0 text-xs font-medium text-danger hover:opacity-80"
          >
            Cambiar
          </button>
        </div>
      </FieldShell>
    );
  }

  return (
    <FieldShell label={label} required={required} error={error}>
      <div className="relative">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          placeholder="Buscar en catálogo…"
          aria-invalid={error ? true : undefined}
          className="w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25"
        />
        {open && (
          <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-border bg-surface-elevated shadow-xl">
            {loading ? (
              <p className="px-3.5 py-3 text-xs text-muted-foreground">
                Buscando…
              </p>
            ) : results.length === 0 ? (
              <p className="px-3.5 py-3 text-xs text-muted-foreground">
                {EMPTY_MESSAGE}
              </p>
            ) : (
              results.map((model) => (
                <button
                  key={model.id}
                  type="button"
                  onMouseDown={() => onSelect(model)}
                  className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left text-sm hover:bg-surface-muted"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-foreground">
                      {model.name}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {[model.brand, model.category, model.displacement]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  {isPricingConfigured(model.fixedPriceCents, model.fixedCommissionCents) ? (
                    <span className="shrink-0 text-xs tabular-nums text-text-secondary">
                      {formatCents(model.fixedPriceCents)}
                    </span>
                  ) : (
                    <span className="shrink-0 text-[11px] text-warning">Sin precio fijo</span>
                  )}
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </FieldShell>
  );
}
