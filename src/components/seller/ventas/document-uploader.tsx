"use client";

import {
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import { cn } from "@/lib/utils";
import { emptyDocument, type DocumentUploadState } from "@/lib/sales/types";
import { ImageEditorModal } from "@/components/seller/ventas/image-editor-modal";

interface DocumentUploaderProps {
  label: string;
  required?: boolean;
  value: DocumentUploadState;
  onChange: (next: DocumentUploadState) => void;
  /** Se dispara al guardar una imagen editada — punto de enganche del OCR. */
  onImageSaved?: (dataUrl: string) => void;
  error?: string;
}

/** Las fotos de la galería suelen pesar más que una captura directa de la
 * cámara (12–64 MP); se leen solo en el dispositivo y el recorte guardado se
 * limita de resolución (ver `crop-image.ts`), así que el tope es holgado. */
const MAX_MB = 30;

type PickSource = "gallery" | "camera";

/** Comprueba que el navegador pueda decodificar la imagen (p. ej. HEIC no se
 * abre en Chrome/Android) antes de abrir el editor. */
function canDecode(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth > 0 && img.naturalHeight > 0);
    img.onerror = () => resolve(false);
    img.src = src;
  });
}

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
  const [pendingSrc, setPendingSrc] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const readFile = (file: File) => {
    if (!file.type.startsWith("image/")) {
      onChange({ ...value, status: "error", error: "Selecciona un archivo de imagen." });
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      onChange({ ...value, status: "error", error: `La imagen supera ${MAX_MB} MB.` });
      return;
    }
    onChange({ ...value, status: "uploading", error: null, fileName: file.name });
    const reader = new FileReader();
    reader.onload = async () => {
      const src = String(reader.result);
      if (!(await canDecode(src))) {
        onChange({
          ...value,
          status: "error",
          error:
            "No pudimos abrir esta imagen (formato no compatible, p. ej. HEIC). Elige una foto JPG o PNG.",
        });
        return;
      }
      setPendingSrc(src);
      setEditorOpen(true);
      onChange({
        ...value,
        status: "editing",
        error: null,
        fileName: file.name,
        originalDataUrl: src,
      });
    };
    reader.onerror = () =>
      onChange({ ...value, status: "error", error: "No se pudo leer el archivo." });
    reader.readAsDataURL(file);
  };

  /** Galería por defecto; la cámara solo si el vendedor la pide. El atributo
   * `capture` se fija justo antes de abrir el selector: con él, el móvil abre
   * la cámara directamente; sin él, abre la galería / los archivos. */
  const pick = (source: PickSource) => {
    const input = inputRef.current;
    if (!input) return;
    if (source === "camera") input.setAttribute("capture", "environment");
    else input.removeAttribute("capture");
    input.click();
  };

  const handleSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) readFile(file);
    e.target.value = "";
  };

  const handleDrop = (e: DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) readFile(file);
  };

  const handleEditorSave = (dataUrl: string) => {
    setEditorOpen(false);
    onChange({
      status: "ready",
      dataUrl,
      fileName: value.fileName,
      originalDataUrl: value.originalDataUrl ?? pendingSrc,
      error: null,
    });
    onImageSaved?.(dataUrl);
  };

  const handleEditorCancel = () => {
    setEditorOpen(false);
    if (value.dataUrl) {
      onChange({ ...value, status: "ready" });
    } else {
      onChange(emptyDocument());
    }
  };

  const reEdit = () => {
    setPendingSrc(value.originalDataUrl ?? value.dataUrl);
    setEditorOpen(true);
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
              onClick={() => onChange(emptyDocument())}
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

      {shownError && <p className="text-[11px] text-danger">{shownError}</p>}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={handleSelect}
        className="hidden"
      />

      <ImageEditorModal
        open={editorOpen}
        src={pendingSrc}
        onCancel={handleEditorCancel}
        onSave={handleEditorSave}
      />
    </div>
  );
}
