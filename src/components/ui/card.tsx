import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SectionHeader } from "@/components/ui/page-header";
import Link from "next/link";
import { formatCents } from "@/lib/money";

/** Superficie base (tarjeta). */
export function Card({ className, children, id }: { className?: string; children: ReactNode; id?: string }) {
  return (
    <div id={id} className={cn("rounded-2xl border border-border bg-surface p-4 sm:p-5", className)}>
      {children}
    </div>
  );
}

/** Tarjeta con encabezado de sección (título + icono + acciones). */
export function SectionCard({
  title,
  icon,
  actions,
  className,
  children,
  id,
}: {
  title: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <Card className={className} id={id}>
      <SectionHeader title={title} icon={icon} actions={actions} />
      {children}
    </Card>
  );
}

/** Par etiqueta/valor de solo lectura. */
export function Fact({ label, value, className }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 break-words text-sm font-medium text-foreground">{value || "—"}</p>
    </div>
  );
}

/** Importe en centavos con tono semántico opcional. */
export function MoneyDisplay({
  cents,
  tone = "default",
  className,
  signed = false,
}: {
  cents: number;
  tone?: "default" | "muted" | "success" | "warning" | "danger" | "brand";
  className?: string;
  signed?: boolean;
}) {
  const text = signed && cents > 0 ? `+${formatCents(cents)}` : cents < 0 ? `-${formatCents(Math.abs(cents))}` : formatCents(cents);
  return (
    <span
      className={cn(
        "tabular-nums",
        tone === "muted" && "text-muted-foreground",
        tone === "success" && "text-success",
        tone === "warning" && "text-warning",
        tone === "danger" && "text-danger",
        tone === "brand" && "text-brand",
        className,
      )}
    >
      {text}
    </span>
  );
}

/** KPI compacto (dashboards). */
export function KpiCard({
  label,
  value,
  hint,
  tone = "default",
  icon,
  href,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "success" | "warning" | "brand" | "info" | "danger";
  icon?: ReactNode;
  href?: string;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
        {icon && <span className="text-muted-foreground">{icon}</span>}
      </div>
      <p
        className={cn(
          "mt-2 text-2xl font-semibold tabular-nums tracking-tight",
          tone === "default" && "text-foreground",
          tone === "success" && "text-success",
          tone === "warning" && "text-warning",
          tone === "brand" && "text-brand",
          tone === "info" && "text-info",
          tone === "danger" && "text-danger",
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </>
  );
  const cls = "block rounded-2xl border border-border bg-surface p-4 transition-colors";
  if (href) {
    return (
      <Link href={href} className={cn(cls, "hover:border-border-strong hover:bg-surface-muted")}>
        {body}
      </Link>
    );
  }
  return <div className={cls}>{body}</div>;
}
