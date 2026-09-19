export function ReportKpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "warning" | "success" | "accent";
}) {
  const toneClass =
    tone === "warning" ? "text-warning"
    : tone === "success" ? "text-success"
    : tone === "accent" ? "text-info"
    : "text-foreground";

  return (
    <div className="rounded-xl border p-4 border-border bg-surface">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1.5 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function ReportSectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{children}</p>;
}
