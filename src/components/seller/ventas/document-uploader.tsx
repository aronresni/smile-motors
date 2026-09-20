"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import { cn } from "@/lib/utils";
import { emptyDocument, type DocumentUploadState } from "@/lib/sales/types";
import { ImageEditorModal } from "@/components/seller/ventas/image-editor-modal";
import {
  prepareImageErrorMessage,
  prepareImageFile,
  type PreparedImage,
} from "@/lib/sales/prepare-image-file";

interface DocumentUploaderProps {
  label: string;
  required?: boolean;
  value: DocumentUploadState;
  onChange: (next: DocumentUploadState) => void;
  /** Se dispara al guardar una imagen editada — punto de enganche del OCR. */
  onImageSaved?: (dataUrl: string) => void;
  error?: string;
}

type PickSource = "gallery" | "camera";

const revoke = (url: string | null) => {
  if (url) URL.revokeObjectURL(url);
};

export function DocumentUploader({
  label,
  required,
  value,
  onChange,
  onImageSaved,
  error,
}: DocumentUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [pending, setPending] = useState<{
    src: string;
    size: { width: number; height: number } | null;
  } | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // El preparado de la imagen es asíncrono y puede tardar varios segundos en
  // un móvil: cuando termina, `value` ya no es el que se capturó al empezar.
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  // Solo cuenta la última foto elegida: si el vendedor elige otra mientras la
  // anterior se procesa, el resultado viejo se descarta (y se libera).
  const attemptRef = useRef(0);
  // Imagen de trabajo GUARDADA: la que abre "Reajustar". Se libera solo
  // cuando otra ocupa su lugar (al guardar el recorte) o al quitar la foto.
  const savedUrlRef = useRef<string | null>(null);
  // Imagen de trabajo PENDIENTE: recién elegida, aún sin confirmar el
  // recorte. Si el vendedor cancela, se libera y vuelve la anterior.
  const pendingUrlRef = useRef<string | null>(null);
  const restoreOriginalRef = useRef<string | null>(null);

  // Al desmontar, libera lo que el estado guardado ya no referencie (una
  // venta a medio llenar conserva su "Reajustar").
  useEffect(
    () => () => {
      revoke(pendingUrlRef.current);
      const url = savedUrlRef.current;
      const current = valueRef.current;
      if (url && current.originalDataUrl !== url && current.dataUrl !== url) revoke(url);
    },
    [],
  );

  const handleFile = useCallback(
    async (file: File) => {
      const attempt = ++attemptRef.current;
      const base = valueRef.current;
      onChange({ ...base, status: "uploading", error: null, fileName: file.name });

      let prepared: PreparedImage | null = null;
      try {
        prepared = await prepareImageFile(file);
      } catch (err) {
        if (attempt !== attemptRef.current) return;
        onChange({
          ...valueRef.current,
          status: "error",
          fileName: file.name,
          error: prepareImageErrorMessage(err),
        });
        return;
      }

      // Llegó tarde (el vendedor ya eligió otra foto): descartar.
      if (attempt !== attemptRef.current) {
        revoke(prepared.url);
        return;
      }

      // Si ya había una elección sin confirmar, la que se restaura al
      // cancelar sigue siendo la ANTERIOR a todas ellas (esa sí sigue viva).
      const hadPending = Boolean(pendingUrlRef.current);
      revoke(pendingUrlRef.current);
      pendingUrlRef.current = prepared.url;
      if (!hadPending) restoreOriginalRef.current = valueRef.current.originalDataUrl;
      setPending({ src: prepared.url, size: { width: prepared.width, height: prepared.height } });
      setEditorOpen(true);
      onChange({
        ...valueRef.current,
        status: "editing",
        error: null,
        fileName: file.name,
        originalDataUrl: prepared.url,
      });
    },
    [onChange],
  );

  /** Galería por defecto; la cámara solo si el vendedor la pide. El atributo
   * `capture` se fija justo antes de abrir el selector: con él, el móvil abre
   * la cámara directamente; sin él, abre la galería / los archivos. */
  const pick = (source: PickSource) => {
    const input = inputRef.current;
    if (!input) return;
    if (source === "camera") input.setAttribute("capture", "environment");
    else input.removeAttribute("capture");
    // Se limpia ANTES de abrir el selector (no después de elegir): así volver
    // a elegir la misma foto dispara `change` igual, y en iOS nunca se toca
    // el input mientras su archivo se está leyendo.
    input.value = "";
    input.click();
  };

  const handleSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Cancelar el selector NO dispara `change` (para eso está el evento
    // `cancel`): si llega aquí sin archivo, o con uno vacío, es que el
    // teléfono no pudo entregar la foto — típico de una foto de iCloud que
    // todavía no está descargada. Sin aviso, la foto "desaparecía" sin más.
    if (!file || file.size === 0) {
      onChange({
        ...valueRef.current,
        status: "error",
        error:
          "No recibimos la foto. Si está guardada en iCloud, ábrela primero en Fotos para que se descargue en el teléfono y vuelve a intentarlo.",
      });
      return;
    }
    void handleFile(file);
  };

  const handleDrop = (e: DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  const handleEditorSave = (dataUrl: string) => {
    setEditorOpen(false);
    const current = valueRef.current;
    if (pendingUrlRef.current) {
      // La nueva foto ocupa el lugar de la anterior: ahora sí se libera.
      revoke(savedUrlRef.current);
      savedUrlRef.current = pendingUrlRef.current;
      pendingUrlRef.current = null;
    }
    onChange({
      status: "ready",
      dataUrl,
      fileName: current.fileName,
      originalDataUrl: savedUrlRef.current ?? current.originalDataUrl ?? pending?.src ?? null,
      error: null,
    });
    onImageSaved?.(dataUrl);
  };

  const handleEditorCancel = () => {
    setEditorOpen(false);
    const current = valueRef.current;
    // Cancelar una foto nueva no debe perder la que ya estaba guardada.
    const hadPending = Boolean(pendingUrlRef.current);
    revoke(pendingUrlRef.current);
    pendingUrlRef.current = null;
    setPending(null);
    if (current.dataUrl) {
      onChange({
        ...current,
        status: "ready",
        originalDataUrl: hadPending ? restoreOriginalRef.current : current.originalDataUrl,
      });
    } else {
      onChange(emptyDocument());
    }
  };

  const reEdit = () => {
    const src = value.originalDataUrl ?? value.dataUrl;
    if (!src) return;
    restoreOriginalRef.current = value.originalDataUrl;
    setPending({ src, size: null });
    setEditorOpen(true);
  };

  const remove = () => {
    attemptRef.current++; // cancela un preparado en curso
    revoke(pendingUrlRef.current);
    revoke(savedUrlRef.current);
    pendingUrlRef.current = null;
    savedUrlRef.current = null;
    setPending(null);
    onChange(emptyDocument());
  };

  const busy = value.status === "uploading" || value.status === "editing";
  const shownError = error ?? value.error;

  return (
    <div className="space-y-1.5">
      <span className="text-xs font-medium text-text-secondary">
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </span>

      {value.status === "ready" && value.dataUrl ? (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value.dataUrl}
            alt={label}
            className="max-h-52 w-full bg-black/40 object-contain"
          />
          <div className="flex flex-wrap gap-3 border-t border-border px-3 py-2 text-xs">
            <button
              type="button"
              onClick={reEdit}
              className="font-medium text-text-secondary hover:text-foreground"
            >
              Reajustar
            </button>
            <button
              type="button"
              onClick={() => pick("gallery")}
              className="font-medium text-text-secondary hover:text-foreground"
            >
              Reemplazar
            </button>
            <button
              type="button"
              onClick={() => pick("camera")}
              className="font-medium text-text-secondary hover:text-foreground"
            >
              Tomar otra foto
            </button>
            <button
              type="button"
              onClick={remove}
              className="font-medium text-danger hover:opacity-80"
            >
              Quitar
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={() => pick("gallery")}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={cn(
              "flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed px-4 py-8 text-center transition-colors",
              dragOver
                ? "border-accent bg-accent-soft"
                : "border-border bg-surface hover:bg-surface-muted",
              shownError && "border-danger",
            )}
          >
            {busy ? (
              <span className="text-xs text-muted-foreground">
                Procesando imagen…
              </span>
            ) : (
              <>
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className="text-muted-foreground"
                >
                  <rect x="3" y="4" width="18" height="16" rx="2" />
                  <circle cx="8.5" cy="9.5" r="1.5" />
                  <path d="m21 16-5-5-9 9" />
                </svg>
                <span className="text-xs font-medium text-text-secondary">
                  Elegir foto de la galería
                </span>
                <span className="text-[11px] text-muted-foreground">
                  Toca para abrir tus fotos · o arrastra una imagen
                </span>
              </>
            )}
          </button>
          {!busy && (
            <button
              type="button"
              onClick={() => pick("camera")}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-text-secondary hover:bg-surface-muted hover:text-foreground"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4 8a2 2 0 0 1 2-2h2l1.5-2h5L18 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2Z" />
                <circle cx="12" cy="12.5" r="3.5" />
              </svg>
              Tomar foto con la cámara
            </button>
          )}
        </div>
      )}

      {shownError && (
        <p role="status" className="text-[11px] text-danger">
          {shownError}
        </p>
      )}

      {/* Visible para el navegador (no `display:none`): iOS abre el selector
       * de fotos de forma más fiable cuando el input está renderizado. */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={handleSelect}
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
      />

      <ImageEditorModal
        open={editorOpen}
        src={pending?.src ?? null}
        srcSize={pending?.size ?? null}
        onCancel={handleEditorCancel}
        onSave={handleEditorSave}
      />
    </div>
  );
}
