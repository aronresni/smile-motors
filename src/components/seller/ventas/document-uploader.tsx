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

const MAX_MB = 12;

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
    reader.onload = () => {
      const src = String(reader.result);
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
              onClick={() => inputRef.current?.click()}
              className="font-medium text-text-secondary hover:text-foreground"
            >
              Reemplazar
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
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
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
                <path d="M4 8a2 2 0 0 1 2-2h2l1.5-2h5L18 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2Z" />
                <circle cx="12" cy="12.5" r="3.5" />
              </svg>
              <span className="text-xs font-medium text-text-secondary">
                Subir o tomar foto
              </span>
              <span className="text-[11px] text-muted-foreground">
                Toca para usar la cámara · o arrastra una imagen
              </span>
            </>
          )}
        </button>
      )}

      {shownError && <p className="text-[11px] text-danger">{shownError}</p>}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
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
