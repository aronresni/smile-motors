"use client";

import { forwardRef, useId, useState, type ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";

type PasswordInputProps = Omit<ComponentPropsWithoutRef<"input">, "type"> & {
  invalid?: boolean;
};

/**
 * Campo de contraseña con botón accesible para mostrar/ocultar.
 * No transforma el valor: solo cambia el `type` del input.
 * Compatible con `register()` de react-hook-form (forwardRef).
 */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ className, invalid, id, ...props }, ref) {
    const [visible, setVisible] = useState(false);
    const generatedId = useId();
    const inputId = id ?? generatedId;

    return (
      <div className="relative">
        <input
          {...props}
          ref={ref}
          id={inputId}
          type={visible ? "text" : "password"}
          aria-invalid={invalid || undefined}
          className={cn(
            "h-12 w-full rounded-xl border bg-surface px-3.5 pr-12 text-[15px] text-foreground sm:text-sm",
            "placeholder:text-muted-foreground/70 outline-none transition",
            "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25",
            invalid ? "border-danger" : "border-border-strong",
            className,
          )}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-xl text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
    );
  },
);

function EyeIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m3 3 18 18" />
      <path d="M10.6 10.6a3 3 0 0 0 4.2 4.2" />
      <path d="M9.9 4.2A11 11 0 0 1 12 4c6.5 0 10 8 10 8a18.5 18.5 0 0 1-3.4 4.3" />
      <path d="M6.6 6.6C3.9 8.3 2 12 2 12s3.5 7 10 7a10.9 10.9 0 0 0 4.4-.9" />
    </svg>
  );
}
