"use client";

import { useCallback, useEffect, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { getCroppedImage } from "@/lib/sales/crop-image";

interface ImageEditorModalProps {
  open: boolean;
  src: string | null;
  onCancel: () => void;
  onSave: (dataUrl: string) => void;
}

/** Recorte/aspecto de tarjeta de identidad (~ CR80: 1.586:1). Se ofrece como
 * atajo opcional — el recorte inicial siempre muestra la foto COMPLETA
 * (ver abajo), nunca una tarjeta horizontal fija que le corte los bordes a
 * una foto vertical. */
const CARD_ASPECT = 1013 / 638;

/**
 * Editor de imagen del documento: recorte, reposición, zoom, rotar ±90°,
 * restablecer, cancelar, guardar. Diseño propio; usa `react-easy-crop`.
 *
 * IMPORTANTE (bug real corregido con las 4 fotos reales de la tarea): el
 * recorte usaba antes un aspecto FIJO 16:10 (horizontal) — con una foto
 * vertical de teléfono (más alta que ancha, típico al fotografiar una
 * licencia/carné sobre una mesa), esa ventana fija por defecto solo muestra
 * una franja delgada del centro, DESCARTANDO en silencio el resto —
 * confirmado: cortaba el nombre, la fecha de nacimiento e incluso el PDF417
 * completo del reverso de una licencia real. Ahora el aspecto inicial es el
 * de la PROPIA foto (así el recorte por defecto muestra el 100% de la
 * imagen, sin perder nada); el vendedor puede acercar/reposicionar para
 * recortar más ajustado si quiere, y "Usar imagen completa" evita el
 * recorte por completo cuando no hace falta.
 */
export function ImageEditorModal({
  open,
  src,
  onCancel,
  onSave,
}: ImageEditorModalProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [areaPixels, setAreaPixels] = useState<Area | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [aspect, setAspect] = useState<number>(CARD_ASPECT);

  // Al cargar cada imagen: el aspecto inicial del recorte pasa a ser el de
  // la PROPIA foto, para que a zoom=1 se vea el 100% de la imagen (nunca se
  // pierde contenido por defecto). El vendedor puede acercar si quiere
  // recortar más ajustado a la tarjeta.
  useEffect(() => {
    if (!open || !src) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
      setAspect(img.naturalWidth / img.naturalHeight || CARD_ASPECT);
    };
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [open, src]);

  const onCropComplete = useCallback((_area: Area, pixels: Area) => {
    setAreaPixels(pixels);
  }, []);

  const reset = () => {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setRotation(0);
    setError(null);
    if (naturalSize) setAspect(naturalSize.width / naturalSize.height || CARD_ASPECT);
  };

  const handleCancel = () => {
    reset();
    onCancel();
  };

  const handleSave = async () => {
    if (!src || !areaPixels) return;
    setSaving(true);
    setError(null);
    try {
      const dataUrl = await getCroppedImage(src, areaPixels, rotation);
      reset();
      onSave(dataUrl);
    } catch {
      setError("No se pudo procesar la imagen. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  };

  /** Atajo: usa la foto tal cual (con la rotación elegida, sin recortar) —
   * garantiza que nada se pierda, para cuando el vendedor no necesita
   * ajustar el encuadre. */
  const handleUseFullImage = async () => {
    if (!src) return;
    setSaving(true);
    setError(null);
    try {
      const img = new Image();
      const loaded = await new Promise<HTMLImageElement>((resolve, reject) => {
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("image_load_failed"));
        img.src = src;
      });
      const rad = (rotation * Math.PI) / 180;
      const boxWidth =
        Math.abs(Math.cos(rad) * loaded.naturalWidth) + Math.abs(Math.sin(rad) * loaded.naturalHeight);
      const boxHeight =
        Math.abs(Math.sin(rad) * loaded.naturalWidth) + Math.abs(Math.cos(rad) * loaded.naturalHeight);
      const dataUrl = await getCroppedImage(
        src,
        { x: 0, y: 0, width: boxWidth, height: boxHeight },
        rotation,
      );
      reset();
      onSave(dataUrl);
    } catch {
      setError("No se pudo procesar la imagen. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleCancel}
      title="Ajustar documento"
      description="Recorta, reposiciona y rota la imagen antes de guardarla."
      size="lg"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={reset} disabled={saving}>
            Restablecer
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleCancel}
            disabled={saving}
          >
            Cancelar
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void handleUseFullImage()}
            disabled={saving || !src}
          >
            Usar imagen completa
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSave}
            disabled={saving || !areaPixels}
          >
            {saving ? "Guardando…" : "Guardar"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="relative h-64 w-full overflow-hidden rounded-xl bg-brand sm:h-80">
          {src && (
            <Cropper
              image={src}
              crop={crop}
              zoom={zoom}
              rotation={rotation}
              aspect={aspect}
              restrictPosition={false}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onRotationChange={setRotation}
              onCropComplete={onCropComplete}
            />
          )}
        </div>

        <p className="text-[11px] text-muted-foreground">
          Por defecto se muestra la foto completa — acerca y reposiciona solo
          si quieres recortar más ajustado a la tarjeta.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setRotation((r) => r - 90)}
          >
            ↺ Rotar izquierda
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setRotation((r) => r + 90)}
          >
            Rotar derecha ↻
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setAspect(CARD_ASPECT)}
          >
            Recortar a forma de tarjeta
          </Button>
          <label className="flex flex-1 items-center gap-2 text-[11px] text-muted-foreground">
            Zoom
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="flex-1"
              style={{ accentColor: "var(--color-accent)" }}
              aria-label="Nivel de zoom"
            />
          </label>
        </div>

        {error && <p className="text-[11px] text-danger">{error}</p>}
      </div>
    </Modal>
  );
}
