import Link from "next/link";
import { ROUTES } from "@/lib/constants";

export type ReportTab = "resumen" | "ventas" | "vendedores" | "productos" | "financieras" | "cobros" | "comisiones" | "liquidaciones";

const TABS: { value: ReportTab; label: string }[] = [
  { value: "resumen", label: "Resumen" },
  { value: "ventas", label: "Ventas" },
  { value: "vendedores", label: "Vendedores" },
  { value: "productos", label: "Productos" },
  { value: "financieras", label: "Financieras" },
  { value: "cobros", label: "Cobros" },
  { value: "comisiones", label: "Comisiones" },
  { value: "liquidaciones", label: "Liquidaciones" },
];

function hrefFor(tab: ReportTab, periodQs: string): string {
  return `${ROUTES.adminReportes}?tab=${tab}${periodQs ? `&${periodQs}` : ""}`;
}

export function ReportTabsNav({ active, periodQs }: { active: ReportTab; periodQs: string }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-border">
      {TABS.map((t) => (
        <Link
          key={t.value}
          href={hrefFor(t.value, periodQs)}
          className={`shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
            t.value === active
              ? "border-brand text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}

export const REPORT_TAB_VALUES = TABS.map((t) => t.value);
