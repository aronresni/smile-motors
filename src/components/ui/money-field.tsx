"use client";

import { useId, useState } from "react";
import { FieldShell } from "@/components/ui/form-fields";
import { centsToInputvalue, parseAmountToCents } from "@/lib/money";
import { cn } from "@/lib/utils";

interface MoneyFieldProps {
  label: string;
  valueCents: number;
  onChangeCents: (cents: number) => void;
  onBlur?: () => void;
  required?: boolean;
  error?: string;
  hint?: string;
  disabled?: boolean;
  readOnly?: boolean;
  placeholder?: string;
}

/**
 * Entrada monetaria. El valor del formulario se guarda en CENTAVOS (entero);
 * el usuario escribe en unidades y decimales.
 */
export function MoneyField({
  label,
  valueCents,
  onChangeCents,
  onBlur,
  required,
  error,
  hint,
  disabled,
  readOnly,
  placeholder = "0.00",
}: MoneyFieldProps) {
  const inputId = useId();
  const [draft, setDraft] = useState("");
  const [focused, setFocused] = useState(false);

  const display = focused ? draft : centsToInputvalue(valueCents);

  return (
    <FieldShell label={label} htmlFor={inputId} required={required} error={error} hint={hint}>
      <div
        className={cn(
          "flex items-center rounded-lg border bg-surface pl-3 pr-1 transition focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25",
          error ? "border-danger" : "border-border",
          (disabled || readOnly) && "opacity-70",
        )}
      >
        <span className="select-none text-sm text-muted-foreground">$</span>
        <input
          id={inputId}
          inputMode="decimal"
          disabled={disabled}
          readOnly={readOnly}
          value={display}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          onFocus={() => {
            if (readOnly) return;
            setFocused(true);
            setDraft(centsToInputvalue(valueCents));
          }}
          onChange={(e) => {
            setDraft(e.target.value);
            onChangeCents(parseAmountToCents(e.target.value));
          }}
          onBlur={() => {
            setFocused(false);
            onChangeCents(parseAmountToCents(draft));
            onBlur?.();
          }}
          className="w-full bg-transparent px-2 py-2.5 text-sm tabular-nums text-foreground outline-none placeholder:text-muted-foreground/60"
        />
      </div>
    </FieldShell>
  );
}
