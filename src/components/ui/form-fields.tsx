"use client";

import {
  forwardRef,
  useId,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

/* --------------------------------------------------------------------------
 * Contenedor de campo: etiqueta, obligatoriedad, error, ayuda, badge OCR
 * ------------------------------------------------------------------------ */
export interface FieldShellProps {
  label: string;
  htmlFor?: string;
  required?: boolean;
  error?: string;
  hint?: ReactNode;
  /** Muestra un distintivo cuando el valor lo rellenó la extracción de datos. */
  autoFilled?: boolean;
  className?: string;
  children: ReactNode;
}

export function FieldShell({
  label,
  htmlFor,
  required,
  error,
  hint,
  autoFilled,
  className,
  children,
}: FieldShellProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center gap-2">
        <label
          htmlFor={htmlFor}
          className="text-xs font-medium text-text-secondary"
        >
          {label}
          {required && <span className="ml-0.5 text-danger">*</span>}
        </label>
        {autoFilled && (
          <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent">
            Autocompletado
          </span>
        )}
      </div>
      {children}
      {error ? (
        <p className="text-[11px] text-danger">{error}</p>
      ) : hint ? (
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

const controlBase =
  "w-full rounded-lg border bg-surface px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-60";

/* --------------------------------------------------------------------------
 * Campos concretos (compatibles con register() de RHF)
 * ------------------------------------------------------------------------ */
type TextFieldProps = Omit<ComponentPropsWithoutRef<"input">, "id"> & {
  label: string;
  id?: string;
  required?: boolean;
  error?: string;
  hint?: ReactNode;
  autoFilled?: boolean;
  containerClassName?: string;
};

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(
  function TextField(
    {
      label,
      id,
      required,
      error,
      hint,
      autoFilled,
      className,
      containerClassName,
      ...props
    },
    ref,
  ) {
    const generatedId = useId();
    const fieldId = id ?? generatedId;
    return (
      <FieldShell
        label={label}
        htmlFor={fieldId}
        required={required}
        error={error}
        hint={hint}
        autoFilled={autoFilled}
        className={containerClassName}
      >
        <input
          {...props}
          ref={ref}
          id={fieldId}
          aria-invalid={error ? true : undefined}
          className={cn(
            controlBase,
            error ? "border-danger" : "border-border",
            className,
          )}
        />
      </FieldShell>
    );
  },
);

type TextAreaFieldProps = Omit<ComponentPropsWithoutRef<"textarea">, "id"> & {
  label: string;
  id?: string;
  required?: boolean;
  error?: string;
  hint?: ReactNode;
  containerClassName?: string;
};

export const TextAreaField = forwardRef<HTMLTextAreaElement, TextAreaFieldProps>(
  function TextAreaField(
    { label, id, required, error, hint, className, containerClassName, ...props },
    ref,
  ) {
    const generatedId = useId();
    const fieldId = id ?? generatedId;
    return (
      <FieldShell
        label={label}
        htmlFor={fieldId}
        required={required}
        error={error}
        hint={hint}
        className={containerClassName}
      >
        <textarea
          {...props}
          ref={ref}
          id={fieldId}
          aria-invalid={error ? true : undefined}
          className={cn(
            controlBase,
            "min-h-[92px] resize-y",
            error ? "border-danger" : "border-border",
            className,
          )}
        />
      </FieldShell>
    );
  },
);

type SelectFieldProps = Omit<ComponentPropsWithoutRef<"select">, "id"> & {
  label: string;
  id?: string;
  required?: boolean;
  error?: string;
  hint?: ReactNode;
  autoFilled?: boolean;
  placeholder?: string;
  options: { value: string; label: string }[];
  containerClassName?: string;
};

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(
  function SelectField(
    {
      label,
      id,
      required,
      error,
      hint,
      autoFilled,
      placeholder,
      options,
      className,
      containerClassName,
      ...props
    },
    ref,
  ) {
    const generatedId = useId();
    const fieldId = id ?? generatedId;
    return (
      <FieldShell
        label={label}
        htmlFor={fieldId}
        required={required}
        error={error}
        hint={hint}
        autoFilled={autoFilled}
        className={containerClassName}
      >
        <select
          {...props}
          ref={ref}
          id={fieldId}
          aria-invalid={error ? true : undefined}
          className={cn(
            controlBase,
            "appearance-none bg-[length:1rem] bg-[right_0.75rem_center] bg-no-repeat pr-9",
            error ? "border-danger" : "border-border",
            className,
          )}
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='none' stroke='%237c828c' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 6l4 4 4-4'/%3E%3C/svg%3E\")",
          }}
        >
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </FieldShell>
    );
  },
);

/* --------------------------------------------------------------------------
 * Campo de solo lectura (VENDEDOR): no editable, valor externo
 * ------------------------------------------------------------------------ */
export function ReadOnlyField({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: ReactNode;
}) {
  return (
    <FieldShell label={label} hint={hint}>
      <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-muted px-3.5 py-2.5 text-sm text-foreground">
        <LockGlyph />
        <span className="truncate">{value}</span>
      </div>
    </FieldShell>
  );
}

function LockGlyph() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0 text-muted-foreground"
    >
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
