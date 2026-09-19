import type { OcrStatus } from "@/lib/sales/types";
import { cn } from "@/lib/utils";

const DEFAULTS: Partial<Record<OcrStatus, string>> = {
  extracting: "Analizando documento…",
  notConfigured:
    "La lectura automática de documentos aún no está disponible. Completa los datos manualmente.",
  error:
    "No pudimos leer algunos datos automáticamente. Puedes completarlos manualmente.",
  partial:
    "Algunos datos no se detectaron. Revísalos y complétalos manualmente.",
  success: "Datos del documento aplicados. Revísalos antes de continuar.",
};

const VISIBLE: OcrStatus[] = [
  "extracting",
  "notConfigured",
  "error",
  "partial",
  "success",
];

export function OcrBanner({
  status,
  message,
  suggestReadjust,
}: {
  status: OcrStatus;
  message: string | null;
  /** Sugiere usar "Reajustar" bajo la imagen (encuadre/foco, no un fallo genérico). */
  suggestReadjust?: boolean;
}) {
  if (!VISIBLE.includes(status)) return null;

  const text = message ?? DEFAULTS[status] ?? "";
  const tone =
    status === "success"
      ? "border-success/30 bg-success/10 text-success"
      : status === "error"
        ? "border-danger/30 bg-danger-surface text-danger"
        : "border-border bg-surface-muted text-text-secondary";

  return (
    <div
      role="status"
      className={cn(
        "flex flex-col gap-1 rounded-xl border px-3.5 py-2.5 text-xs",
        tone,
      )}
    >
      <div className="flex items-center gap-2">
      {status === "extracting" && (
        <svg
          className="h-3.5 w-3.5 animate-spin"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <circle
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
            className="opacity-25"
          />
          <path
            d="M12 2a10 10 0 0 1 10 10"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </svg>
      )}
        <span>{text}</span>
      </div>
      {suggestReadjust && (
        <p className="pl-0.5 text-[11px] opacity-90">
          Usa <strong>Reajustar</strong> bajo la imagen: asegúrate de que el
          documento ocupe la mayor parte de la foto y que el código o el
          texto estén enfocados.
        </p>
      )}
    </div>
  );
}
