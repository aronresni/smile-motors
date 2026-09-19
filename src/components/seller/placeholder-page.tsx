import Link from "next/link";
import { ROUTES } from "@/lib/constants";
import { ChevronLeftIcon } from "@/components/seller/icons";

interface PlaceholderPageProps {
  title: string;
  description: string;
}

/** Página de sección aún sin funcionalidad de negocio. */
export function PlaceholderPage({ title, description }: PlaceholderPageProps) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          {description}
        </p>
      </div>

      <div className="rounded-2xl border border-dashed border-border bg-surface/60 px-5 py-10 text-center">
        <p className="text-sm text-text-secondary">En construcción</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Esta sección se implementará en una tarea posterior.
        </p>
        <Link
          href={ROUTES.seller}
          prefetch
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:text-foreground"
        >
          <ChevronLeftIcon size={14} />
          Volver al panel
        </Link>
      </div>
    </div>
  );
}
