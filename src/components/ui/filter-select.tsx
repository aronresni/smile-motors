"use client";

import { useId, useState, type ReactNode } from "react";
import * as Select from "@radix-ui/react-select";
import { CheckIcon, ChevronDownIcon } from "@/components/ui/icons";
import { FieldShell } from "@/components/ui/form-fields";
import { cn } from "@/lib/utils";

/**
 * FILTRO DESPLEGABLE de Smile Motors — reemplaza al `<select>` nativo en las
 * barras de filtros (Admin y Vendedor). El menú nativo del sistema operativo
 * no se puede estilizar de forma consistente (fondo blanco/azul de Windows),
 * así que el menú es un listbox accesible de Radix (`@radix-ui/react-select`):
 * teclado completo (Tab, Enter/Espacio/flechas para abrir, flechas, Home/End,
 * búsqueda por letras, Enter para elegir, Escape), roles ARIA
 * combobox/listbox/option, cierre al hacer clic fuera, portal (nunca queda
 * recortado por `overflow: hidden`) y se abre hacia arriba si no hay espacio.
 *
 * Dos modos, para conservar exactamente la lógica actual de cada filtro:
 *  - CONTROLADO: `value` + `onValueChange` (filtros que navegan por URL).
 *  - NO CONTROLADO: `defaultValue` + `name` dentro de un `<form method="get">`:
 *    un `<input type="hidden">` envía el valor REAL (incluido "" = "Todos")
 *    igual que lo hacía el `<select name=…>` nativo.
 */
export interface FilterSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface FilterSelectProps {
  options: FilterSelectOption[];
  /** Etiqueta visible encima del botón (y nombre accesible). */
  label?: string;
  /** Prefijo dentro del botón y de cada opción: "Operación" → "Operación: Cuba". */
  prefix?: string;
  /** Nombre accesible cuando no hay `label` visible (por defecto, `prefix`). */
  ariaLabel?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** Nombre del campo al enviarse dentro de un `<form>` (modo no controlado). */
  name?: string;
  placeholder?: string;
  disabled?: boolean;
  size?: "sm" | "md";
  /** Clases del botón disparador. */
  className?: string;
  /** Clases del contenedor (etiqueta + botón). */
  containerClassName?: string;
  id?: string;
}

// Radix no admite `value=""` en una opción: "" (≈ "Todos") viaja con un
// centinela interno y se traduce de vuelta; los valores reales no cambian.
const EMPTY = "__filter-select-empty__";
const toRadix = (v: string) => (v === "" ? EMPTY : v);
const fromRadix = (v: string) => (v === EMPTY ? "" : v);

export function FilterSelect({
  options,
  label,
  prefix,
  ariaLabel,
  value,
  defaultValue,
  onValueChange,
  name,
  placeholder = "Seleccionar",
  disabled,
  size = "sm",
  className,
  containerClassName,
  id,
}: FilterSelectProps) {
  const labelId = useId();
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue ?? "");
  // Si el valor inicial cambia (p. ej. navegación a la misma página con otros
  // filtros), el estado interno se re-sincroniza — ajuste en render, sin efecto.
  const [syncedDefault, setSyncedDefault] = useState(defaultValue);
  if (!controlled && defaultValue !== syncedDefault) {
    setSyncedDefault(defaultValue);
    setInner(defaultValue ?? "");
  }
  const current = controlled ? value : inner;
  const selected = options.find((o) => o.value === current);
  const text = (o: FilterSelectOption) => (prefix ? `${prefix}: ${o.label}` : o.label);

  const change = (radixValue: string) => {
    // Dentro de un <form>, Radix mantiene un <select> oculto (autocompletado
    // del navegador) que, si el valor llega antes que sus opciones, emite ""
    // en crudo. Ninguna opción real vale "" (usa el centinela EMPTY), así que
    // ese "" nunca es una elección del usuario: se ignora.
    if (radixValue === "") return;
    const next = fromRadix(radixValue);
    if (!controlled) setInner(next);
    onValueChange?.(next);
  };

  return (
    <div className={cn("min-w-0", containerClassName)}>
      {label && (
        <span id={labelId} className="mb-1 block text-[11px] font-medium text-muted-foreground">
          {label}
        </span>
      )}
      <Select.Root
        // Siempre controlado: "" (sin opción coincidente todavía, p. ej. mientras
        // cargan las opciones) muestra el marcador; nunca `undefined`, que dejaría
        // a Radix en modo no controlado e ignoraría el valor cuando llegue.
        value={selected ? toRadix(current) : ""}
        onValueChange={change}
        disabled={disabled}
      >
        <Select.Trigger
          id={id}
          aria-labelledby={label ? labelId : undefined}
          aria-label={label ? undefined : (ariaLabel ?? (id ? undefined : prefix))}
          className={cn(
            "group inline-flex w-full max-w-full items-center justify-between gap-2 rounded-xl border border-border-strong bg-surface text-left text-foreground transition-colors",
            "hover:border-muted-foreground/40 hover:bg-surface-elevated",
            "focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
            "data-[state=open]:border-brand data-[placeholder]:text-muted-foreground",
            "disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-muted disabled:text-muted-foreground disabled:opacity-60 disabled:hover:bg-surface-muted",
            size === "sm" ? "min-h-11 px-3 text-sm sm:min-h-9" : "min-h-11 px-3.5 text-sm sm:min-h-10",
            className,
          )}
        >
          <span className="min-w-0 truncate">
            <Select.Value placeholder={prefix ? `${prefix}: ${placeholder}` : placeholder}>
              {selected ? text(selected) : undefined}
            </Select.Value>
          </span>
          <Select.Icon className="inline-flex shrink-0 text-muted-foreground transition-transform duration-150 group-data-[state=open]:rotate-180 group-data-[state=open]:text-brand">
            <ChevronDownIcon size={16} />
          </Select.Icon>
        </Select.Trigger>

        <Select.Portal>
          <Select.Content
            position="popper"
            side="bottom"
            align="start"
            sideOffset={6}
            collisionPadding={8}
            className={cn(
              "theme-dark z-[60] min-w-[var(--radix-select-trigger-width)] max-w-[calc(100vw-1rem)]",
              "max-h-[min(22rem,var(--radix-select-content-available-height))] overflow-hidden",
              "rounded-xl border border-border-strong bg-surface text-foreground shadow-2xl shadow-black/60",
            )}
          >
            <Select.ScrollUpButton className="flex h-6 items-center justify-center text-muted-foreground">
              <ChevronDownIcon size={14} className="rotate-180" />
            </Select.ScrollUpButton>
            <Select.Viewport className="p-1">
              {options.map((o) => (
                <Select.Item
                  key={o.value}
                  value={toRadix(o.value)}
                  disabled={o.disabled}
                  className={cn(
                    "relative flex min-h-11 cursor-pointer select-none items-center rounded-lg py-2 pl-8 pr-3 text-sm text-foreground outline-none sm:min-h-9",
                    "data-[highlighted]:bg-surface-elevated",
                    "data-[state=checked]:bg-brand-soft data-[state=checked]:font-semibold data-[state=checked]:text-brand",
                    "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
                  )}
                >
                  <Select.ItemIndicator className="absolute left-2.5 inline-flex items-center">
                    <CheckIcon size={15} />
                  </Select.ItemIndicator>
                  <Select.ItemText>{text(o)}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.Viewport>
            <Select.ScrollDownButton className="flex h-6 items-center justify-center text-muted-foreground">
              <ChevronDownIcon size={14} />
            </Select.ScrollDownButton>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
      {name && <input type="hidden" name={name} value={current} />}
    </div>
  );
}

/**
 * Versión de CAMPO DE FORMULARIO del mismo desplegable (etiqueta, obligatorio,
 * error y ayuda del sistema de formularios). Solo para campos CONTROLADOS
 * (`value` + `onValueChange`); los campos enlazados con `register()` de React
 * Hook Form siguen usando `SelectField`.
 * `placeholder` añade una opción "" seleccionable, igual que `SelectField`.
 */
export function SelectMenuField({
  label,
  required,
  error,
  hint,
  placeholder,
  disabled,
  value,
  onValueChange,
  options,
  containerClassName,
}: {
  label: string;
  required?: boolean;
  error?: string;
  hint?: ReactNode;
  placeholder?: string;
  disabled?: boolean;
  value: string;
  onValueChange: (value: string) => void;
  options: FilterSelectOption[];
  containerClassName?: string;
}) {
  const fieldId = useId();
  return (
    <FieldShell label={label} htmlFor={fieldId} required={required} error={error} hint={hint} className={containerClassName}>
      <FilterSelect
        id={fieldId}
        size="md"
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        placeholder={placeholder}
        options={placeholder !== undefined ? [{ value: "", label: placeholder }, ...options] : options}
        className={cn("w-full rounded-lg", error ? "border-danger" : undefined)}
      />
    </FieldShell>
  );
}
