"use client";

import { TextField } from "@/components/ui/form-fields";
import { CUBA_PHONE_PREFIX } from "@/lib/sales/cuba-provinces";

function formatUS(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

function formatCU(raw: string): string {
  let d = raw.replace(/[^\d]/g, "");
  d = d.replace(/^53/, "").slice(0, 8);
  return d ? `${CUBA_PHONE_PREFIX} ${d}` : "";
}

interface PhoneFieldProps {
  label: string;
  country: "us" | "cu";
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  required?: boolean;
  error?: string;
  containerClassName?: string;
}

/** Teléfono con formateo suave (no bloquea formatos válidos). */
export function PhoneField({
  label,
  country,
  value,
  onChange,
  onBlur,
  required,
  error,
  containerClassName,
}: PhoneFieldProps) {
  const format = country === "us" ? formatUS : formatCU;
  return (
    <TextField
      label={label}
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      required={required}
      error={error}
      hint={
        country === "cu"
          ? "Incluye el prefijo +53"
          : undefined
      }
      containerClassName={containerClassName}
      value={value}
      placeholder={country === "us" ? "(555) 000-0000" : "+53 5XXXXXXX"}
      onChange={(e) => onChange(format(e.target.value))}
      onBlur={onBlur}
    />
  );
}
