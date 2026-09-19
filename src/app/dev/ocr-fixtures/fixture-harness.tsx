"use client";

import { useEffect, useState } from "react";
import { extractBuyerId, extractRecipientId } from "@/lib/sales/document-extraction";
import type {
  ExtractedDocumentData,
  ExtractedRecipientData,
  ExtractionResult,
} from "@/lib/sales/types";

/**
 * Arnés de pruebas LOCAL contra las 4 fotos reales de la tarea (u otras).
 * Ejercita el pipeline REAL (el mismo `document-extraction.ts` que usa el
 * formulario) en el navegador real — la parte de rasterizado/ZXing/Tesseract
 * necesita DOM y no puede probarse desde Node. Nada se sube a ningún sitio:
 * todo el procesamiento ocurre aquí mismo, en memoria del navegador.
 *
 * Checklist de referencia (de la especificación de la tarea) — NO es una
 * comparación automática contra valores fijos: el desarrollador compara a
 * simple vista contra la foto física.
 */
const US_CHECKLIST = [
  "Nombre", "Apellido", "N.º de licencia", "Fecha de nacimiento",
  "Fecha de expiración", "Dirección (calle)", "Ciudad", "Estado = NE", "ZIP",
];
const CU_CHECKLIST = [
  "Nombre completo (nombres + apellidos)", "N.º de identidad (NI, 11 dígitos)",
];

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("read_failed"));
    reader.readAsDataURL(file);
  });
}

function Picker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (dataUrl: string | null) => void;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-text-secondary">{label}</span>
      {value ? (
        <div className="overflow-hidden rounded-lg border border-border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt={label} className="max-h-40 w-full bg-surface-muted object-contain" />
          <button
            type="button"
            onClick={() => onChange(null)}
            className="w-full border-t border-border py-1 text-xs text-danger hover:bg-danger/10"
          >
            Quitar
          </button>
        </div>
      ) : (
        <input
          type="file"
          accept="image/*"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) onChange(await readFileAsDataUrl(file));
            e.target.value = "";
          }}
          className="block w-full rounded-lg border border-dashed border-border-strong p-3 text-xs"
        />
      )}
    </label>
  );
}

/** Overlay "REGIÓN DETECTADA" sobre la imagen del reverso: dibuja el
 * rectángulo (coordenadas de imagen original → % del elemento renderizado)
 * que `locateBarcodeRegion` le pasó al decodificador. Ver `pdf417.ts`. */
function RegionOverlay({
  imageDataUrl,
  rect,
  dims,
}: {
  imageDataUrl: string;
  rect: { x: number; y: number; width: number; height: number };
  dims: { width: number; height: number };
}) {
  if (!dims.width || !dims.height) return null;
  return (
    <div className="relative inline-block max-w-full overflow-hidden rounded-lg border border-border">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageDataUrl} alt="Reverso con región detectada" className="block max-h-64 w-auto" />
      <div
        className="pointer-events-none absolute border-2 border-danger bg-danger/10"
        style={{
          left: `${(rect.x / dims.width) * 100}%`,
          top: `${(rect.y / dims.height) * 100}%`,
          width: `${(rect.width / dims.width) * 100}%`,
          height: `${(rect.height / dims.height) * 100}%`,
        }}
      />
      <span className="absolute left-1 top-1 rounded bg-danger px-1.5 py-0.5 text-[10px] font-bold text-white">
        REGIÓN DETECTADA
      </span>
    </div>
  );
}

/** Resumen legible del pipeline (item "PANEL DE DEBUG" de la tarea): qué
 * decodificador primario/respaldo corrió, si detectó región, estado del OCR
 * y el veredicto final — antes del JSON crudo, para lectura rápida. */
function DecoderSummary({ debug, status }: { debug: NonNullable<ExtractionResult<unknown>["debug"]>; status: string }) {
  const wasmAttempts = (debug.pdf417Attempts ?? []).filter((a) => a.decoder === "zxing-wasm");
  const jsAttempts = (debug.pdf417Attempts ?? []).filter((a) => a.decoder === "zxing-js");
  const wasmRan = wasmAttempts.length > 0;
  const wasmOk = wasmAttempts.some((a) => a.success);
  const jsRan = jsAttempts.length > 0;
  const jsOk = jsAttempts.some((a) => a.success);
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-border bg-surface p-2.5 text-[11px]">
      <span>
        <strong>PDF417 primario (ZXing-C++/WASM):</strong>{" "}
        {debug.documentType !== "us-license" ? "n/a" : wasmRan ? (wasmOk ? "✅ éxito" : "❌ falló") : "no corrió"}
      </span>
      <span>
        <strong>PDF417 respaldo (ZXing JS):</strong>{" "}
        {debug.documentType !== "us-license" ? "n/a" : jsRan ? (jsOk ? "✅ éxito" : "❌ falló") : "no corrió (WASM ya tuvo éxito o no aplicó)"}
      </span>
      <span><strong>Región detectada:</strong> {debug.regionDetected ? "sí" : "no"}</span>
      <span><strong>OCR inicializó:</strong> {debug.ocrError ? "❌ no (ver ocrError abajo)" : "sí"}</span>
      <span><strong>OCR produjo texto:</strong> {debug.rawOcrTextPreview ? "sí" : debug.ocrError ? "n/a (falló antes)" : "no / no hizo falta"}</span>
      <span><strong>Confianza OCR:</strong> {debug.ocrConfidence?.toFixed(2) ?? "—"}</span>
      <span><strong>Campos detectados:</strong> {debug.parsedFields.length}</span>
      <span><strong>Veredicto final:</strong> {status.toUpperCase()}</span>
    </div>
  );
}

function ResultPanel<T>({
  result,
  backImage,
}: {
  result: ExtractionResult<T> | null;
  backImage: string | null;
}) {
  if (!result) return <p className="text-xs text-muted-foreground">Sin resultado todavía.</p>;
  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface-muted p-3 text-xs">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <span><strong>status:</strong> {result.status}</span>
        <span><strong>confidence:</strong> {result.confidence}</span>
        {result.errorCode && <span><strong>errorCode:</strong> {result.errorCode}</span>}
      </div>
      {result.message && <p className="text-text-secondary">{result.message}</p>}

      {result.debug && <DecoderSummary debug={result.debug} status={result.status} />}

      {result.debug?.regionRect && backImage && result.debug.originalDimensions && (
        <RegionOverlay
          imageDataUrl={backImage}
          rect={result.debug.regionRect}
          dims={result.debug.originalDimensions}
        />
      )}

      <div>
        <p className="mb-1 font-semibold">Campos extraídos (data):</p>
        <pre className="overflow-auto rounded bg-surface p-2">{JSON.stringify(result.data, null, 2)}</pre>
      </div>
      <div>
        <p className="mb-1 font-semibold">Origen por campo (fieldSources):</p>
        <pre className="overflow-auto rounded bg-surface p-2">{JSON.stringify(result.fieldSources, null, 2)}</pre>
      </div>
      {result.debug && (
        <div>
          <p className="mb-1 font-semibold">Debug completo:</p>
          <pre className="overflow-auto rounded bg-surface p-2">{JSON.stringify(result.debug, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

function DocumentSection<T>({
  title,
  checklist,
  run,
  testId,
  generateSynthetic,
  generateSyntheticLowRes,
}: {
  title: string;
  checklist: string[];
  run: (front?: string, back?: string) => Promise<ExtractionResult<T>>;
  testId: string;
  /** Genera un par frente/reverso SINTÉTICO (no una foto real) para probar
   * el pipeline de extremo a extremo sin depender de fotos reales — ver
   * `dev-fixture-generator.ts`. Usado por la prueba E2E y para depuración
   * manual rápida. */
  generateSynthetic?: () => Promise<{ front: string; back: string }>;
  /** Solo el REVERSO, como una foto comprimida de la galería (baja
   * resolución) — el caso real que dejaba el formulario vacío. */
  generateSyntheticLowRes?: () => Promise<string>;
}) {
  const [front, setFront] = useState<string | null>(null);
  const [back, setBack] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [result, setResult] = useState<ExtractionResult<T> | null>(null);

  const extract = async () => {
    if (!front && !back) return;
    setBusy(true);
    try {
      setResult(await run(front ?? undefined, back ?? undefined));
    } finally {
      setBusy(false);
    }
  };

  const generate = async () => {
    if (!generateSynthetic) return;
    setGenBusy(true);
    try {
      const { front: f, back: b } = await generateSynthetic();
      setFront(f);
      setBack(b);
      setResult(null);
    } finally {
      setGenBusy(false);
    }
  };

  const generateLowRes = async () => {
    if (!generateSyntheticLowRes) return;
    setGenBusy(true);
    try {
      setFront(null);
      setBack(await generateSyntheticLowRes());
      setResult(null);
    } finally {
      setGenBusy(false);
    }
  };

  return (
    <section className="space-y-3 rounded-xl border border-border p-4" data-testid={testId}>
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="text-[11px] text-muted-foreground">
        Se espera poder identificar: {checklist.join(" · ")}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Picker label="Frente" value={front} onChange={setFront} />
        <Picker label="Reverso" value={back} onChange={setBack} />
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void extract()}
          disabled={busy || (!front && !back)}
          data-testid={`${testId}-extract`}
          className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground disabled:opacity-40"
        >
          {busy ? "Extrayendo…" : "Extraer"}
        </button>
        {generateSynthetic && (
          <button
            type="button"
            onClick={() => void generate()}
            disabled={genBusy}
            data-testid={`${testId}-generate-synthetic`}
            className="rounded-lg border border-border-strong px-3 py-1.5 text-xs font-medium text-text-secondary disabled:opacity-40"
          >
            {genBusy ? "Generando…" : "Generar fixture sintética"}
          </button>
        )}
        {generateSyntheticLowRes && (
          <button
            type="button"
            onClick={() => void generateLowRes()}
            disabled={genBusy}
            data-testid={`${testId}-generate-synthetic-lowres`}
            className="rounded-lg border border-border-strong px-3 py-1.5 text-xs font-medium text-text-secondary disabled:opacity-40"
          >
            Reverso sintético de baja resolución
          </button>
        )}
      </div>
      <div data-testid={`${testId}-result`}>
        <ResultPanel result={result} backImage={back} />
      </div>
    </section>
  );
}

export function OcrFixtureHarness() {
  useEffect(() => {
    try {
      window.localStorage.setItem("motods:ocr-debug", "1");
    } catch {
      /* localStorage no disponible (modo privado, etc.) */
    }
  }, []);

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-lg font-semibold">OCR fixtures — arnés de pruebas local</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Elige las fotos reales (o cualquier otra) para ejercitar el pipeline
          de extracción LOCAL tal cual lo usa el formulario de venta. Nada se
          sube a ningún sitio — todo corre en este navegador. El modo debug
          queda activado automáticamente en esta página.
        </p>
      </div>

      <DocumentSection<ExtractedDocumentData>
        title="Licencia de EE. UU."
        checklist={US_CHECKLIST}
        testId="us-license"
        run={(front, back) => extractBuyerId({ frontImage: front, backImage: back })}
        generateSynthetic={async () => {
          const {
            generateSyntheticUsBackImage,
            generateSyntheticUsFrontImage,
          } = await import("@/lib/sales/extraction/dev-fixture-generator");
          const [back, front] = await Promise.all([
            generateSyntheticUsBackImage(),
            Promise.resolve(generateSyntheticUsFrontImage()),
          ]);
          return { front, back };
        }}
        generateSyntheticLowRes={async () => {
          const { generateSyntheticUsBackLowResImage } = await import(
            "@/lib/sales/extraction/dev-fixture-generator"
          );
          return generateSyntheticUsBackLowResImage();
        }}
      />

      <DocumentSection<ExtractedRecipientData>
        title="Carné de identidad cubano"
        checklist={CU_CHECKLIST}
        testId="cuban-id"
        run={(front, back) => extractRecipientId({ frontImage: front, backImage: back })}
        generateSynthetic={async () => {
          const {
            generateSyntheticCubanBackImage,
            generateSyntheticCubanFrontImage,
          } = await import("@/lib/sales/extraction/dev-fixture-generator");
          return {
            front: generateSyntheticCubanFrontImage(),
            back: generateSyntheticCubanBackImage(),
          };
        }}
      />
    </main>
  );
}
