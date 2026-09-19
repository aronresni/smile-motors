import Link from "next/link";
import { ROUTES } from "@/lib/constants";
import { cn } from "@/lib/utils";

interface OperationOption {
  key: string;
  name: string;
  description: string;
  href: string | null;
  tag: string;
  tagTone: "primary" | "neutral" | "muted";
  Icon: () => React.ReactNode;
}

const OPTIONS: OperationOption[] = [
  {
    key: "cuba",
    name: "Envío internacional · Cuba",
    description:
      "Venta de un vehículo que se exporta y se entrega a un destinatario en Cuba. Incluye datos del receptor y logística.",
    href: ROUTES.sellerVentaNuevaCuba,
    tag: "Más frecuente",
    tagTone: "primary",
    Icon: GlobeIcon,
  },
  {
    key: "usa",
    name: "Venta nacional · USA",
    description:
      "Transacción dentro de territorio estadounidense. El formulario detallado llega en la próxima entrega.",
    href: ROUTES.sellerVentaNuevaUsa,
    tag: "Disponible pronto",
    tagTone: "neutral",
    Icon: FlagIcon,
  },
  {
    key: "local",
    name: "Operación local / showroom",
    description:
      "Venta directa en el concesionario, sin logística de exportación ni envío internacional.",
    href: null,
    tag: "No disponible",
    tagTone: "muted",
    Icon: StoreIcon,
  },
];

const TAG_TONE: Record<OperationOption["tagTone"], string> = {
  primary: "bg-accent-soft text-accent",
  neutral: "bg-surface-muted text-text-secondary",
  muted: "bg-surface-muted text-muted-foreground",
};

export function OperationSelector() {
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">
          Nueva operación
        </p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          Iniciar nueva operación
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Elige el flujo de venta que corresponde a esta operación.
        </p>
      </div>

      <ul className="space-y-3">
        {OPTIONS.map((opt) => {
          const disabled = opt.href === null;
          const inner = (
            <div
              className={cn(
                "flex gap-4 rounded-2xl border p-4 transition-colors",
                disabled
                  ? "border-border bg-surface/50 opacity-60"
                  : "border-border bg-surface hover:border-accent/50 hover:bg-surface-muted",
                opt.tagTone === "primary" && !disabled && "border-accent/40",
              )}
            >
              <span
                className={cn(
                  "grid h-11 w-11 shrink-0 place-items-center rounded-xl",
                  disabled
                    ? "bg-surface-muted text-muted-foreground"
                    : "bg-accent-soft text-accent",
                )}
              >
                <opt.Icon />
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-semibold text-foreground">
                    {opt.name}
                  </h2>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-medium",
                      TAG_TONE[opt.tagTone],
                    )}
                  >
                    {opt.tag}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {opt.description}
                </p>
                {!disabled && (
                  <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent">
                    Continuar
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.25"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M5 12h14M13 6l6 6-6 6" />
                    </svg>
                  </span>
                )}
              </div>
            </div>
          );

          return (
            <li key={opt.key}>
              {opt.href ? (
                <Link href={opt.href} prefetch className="block">
                  {inner}
                </Link>
              ) : (
                <div aria-disabled="true">{inner}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function GlobeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.7 3.8 5.9 3.8 9S14.5 21.3 12 21c-2.5-.3-3.8-5.9-3.8-9S9.5 5.7 12 3Z" />
    </svg>
  );
}

function FlagIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 21V4M5 4c3-1.5 6 1.5 9 0s5-1 5-1v10s-2 .5-5 2-6-1.5-9 0" />
    </svg>
  );
}

function StoreIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 9 5 4h14l1 5M5 9v11h14V9M4 9h16" />
      <path d="M9 20v-6h6v6" />
    </svg>
  );
}
