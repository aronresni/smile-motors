"use client";

import { useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type SectionStatus = "incomplete" | "complete" | "error";

const STATUS_META: Record<
  SectionStatus,
  { label: string; text: string; dot: string }
> = {
  incomplete: {
    label: "Incompleta",
    text: "text-muted-foreground",
    dot: "bg-muted-foreground",
  },
  complete: { label: "Completa", text: "text-success", dot: "bg-success" },
  error: { label: "Revisar", text: "text-danger", dot: "bg-danger" },
};

interface FormSectionProps {
  id: string;
  index?: number;
  title: string;
  description?: string;
  status?: SectionStatus;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function FormSection({
  id,
  index,
  title,
  description,
  status = "incomplete",
  defaultOpen = true,
  children,
}: FormSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  const meta = STATUS_META[status];

  return (
    <section
      id={id}
      className={cn(
        "scroll-mt-24 rounded-2xl border bg-surface",
        status === "error" ? "border-danger/40" : "border-border",
      )}
    >
      <div className="flex items-center gap-3 px-4 py-3.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          {index !== undefined && (
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-surface-muted text-[11px] font-semibold text-text-secondary">
              {index}
            </span>
          )}
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-foreground">
              {title}
            </span>
            {description && (
              <span className="block truncate text-[11px] text-muted-foreground">
                {description}
              </span>
            )}
          </span>
        </button>

        <span
          className={cn(
            "hidden shrink-0 items-center gap-1.5 text-[11px] font-medium sm:flex",
            meta.text,
          )}
        >
          <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
          {meta.label}
        </span>

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Contraer sección" : "Expandir sección"}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-surface-muted hover:text-foreground"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
            className={cn("transition-transform", open && "rotate-180")}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </div>

      {open && (
        <div id={bodyId} className="border-t border-border px-4 py-4">
          {children}
        </div>
      )}
    </section>
  );
}
