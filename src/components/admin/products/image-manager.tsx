"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { env } from "@/lib/env";
import { productActionErrorText } from "@/lib/admin/product-errors";
import type { AdminProductImage } from "@/lib/admin/products";
import { productImagePublicUrl } from "@/lib/admin/product-image-url";
import {
  addProductImage,
  removeProductImage,
  reorderProductImages,
  setPrimaryProductImage,
} from "@/app/(admin)/admin/productos/actions";

const MAX_MB = 8;
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MIN_DIMENSION = 200;

function checkDimensions(file: File): Promise<{ ok: boolean; reason?: string }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      if (img.width < MIN_DIMENSION || img.height < MIN_DIMENSION) {
        resolve({ ok: false, reason: `La imagen debe medir al menos ${MIN_DIMENSION}×${MIN_DIMENSION}px.` });
        return;
      }
      resolve({ ok: true });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ ok: false, reason: "No se pudo leer la imagen." });
    };
    img.src = url;
  });
}

export function ImageManager({ productId, images }: { productId: string; images: AdminProductImage[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sorted = [...images].sort((a, b) => a.position - b.position);

  const uploadFile = async (file: File) => {
    setError(null);
    if (!ACCEPTED_TYPES.has(file.type)) {
      setError("Solo se aceptan imágenes JPEG, PNG o WebP.");
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`La imagen supera ${MAX_MB} MB.`);
      return;
    }
    const dims = await checkDimensions(file);
    if (!dims.ok) {
      setError(dims.reason ?? "Imagen inválida.");
      return;
    }

    setBusy(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const storagePath = `${productId}/${crypto.randomUUID()}.${ext}`;
      const supabase = createClient();
      const { error: upErr } = await supabase.storage
        .from("product-images")
        .upload(storagePath, file, { upsert: false, contentType: file.type });
      if (upErr) throw upErr;

      const res = await addProductImage(productId, storagePath);
      if (!res.ok) {
        setError(productActionErrorText(res.code));
        setBusy(false);
        return;
      }
      router.refresh();
    } catch {
      setError("No se pudo subir la imagen.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = async (image: AdminProductImage) => {
    if (busy) return;
    if (!confirm("¿Quitar esta imagen del producto?")) return;
    setBusy(true);
    setError(null);
    const res = await removeProductImage(image.id, productId);
    if (!res.ok) {
      setError(productActionErrorText(res.code));
      setBusy(false);
      return;
    }
    if (image.storagePath) {
      const supabase = createClient();
      await supabase.storage.from("product-images").remove([image.storagePath]);
    }
    setBusy(false);
    router.refresh();
  };

  const makePrimary = async (image: AdminProductImage) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await setPrimaryProductImage(image.id, productId);
    if (!res.ok) setError(productActionErrorText(res.code));
    setBusy(false);
    router.refresh();
  };

  const move = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= sorted.length) return;
    const next = [...sorted];
    [next[index], next[target]] = [next[target], next[index]];
    setError(null);
    const res = await reorderProductImages(productId, next.map((i) => i.id));
    if (!res.ok) setError(productActionErrorText(res.code));
    router.refresh();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {sorted.length === 0 ? "Sin imágenes." : `${sorted.length} imagen(es). La primera es la imagen principal.`}
        </p>
        <div>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadFile(file);
            }}
          />
          <Button variant="secondary" size="sm" onClick={() => inputRef.current?.click()} disabled={busy}>
            {busy ? "Subiendo…" : "Subir imagen"}
          </Button>
        </div>
      </div>

      {error && <p role="alert" className="text-xs text-danger">{error}</p>}

      {sorted.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {sorted.map((img, i) => (
            <div key={img.id} className="group relative overflow-hidden rounded-xl border border-border">
              <div className="relative aspect-square bg-surface-muted">
                {img.storagePath ? (
                  <Image
                    src={productImagePublicUrl(env.NEXT_PUBLIC_SUPABASE_URL, img.storagePath)}
                    alt=""
                    fill
                    sizes="200px"
                    className="object-cover"
                    unoptimized
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground">
                    Legado sin archivo
                  </div>
                )}
                {i === 0 && (
                  <span className="absolute left-1.5 top-1.5 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-foreground">
                    Principal
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between gap-1 border-t p-1.5 border-border">
                <div className="flex gap-1">
                  <button
                    type="button"
                    disabled={i === 0}
                    onClick={() => void move(i, -1)}
                    aria-label="Mover antes"
                    className="rounded px-1 text-muted-foreground disabled:opacity-20 hover:text-foreground"
                  >
                    ◀
                  </button>
                  <button
                    type="button"
                    disabled={i === sorted.length - 1}
                    onClick={() => void move(i, 1)}
                    aria-label="Mover después"
                    className="rounded px-1 text-muted-foreground disabled:opacity-20 hover:text-foreground"
                  >
                    ▶
                  </button>
                </div>
                <div className="flex gap-1">
                  {i !== 0 && (
                    <button
                      type="button"
                      onClick={() => void makePrimary(img)}
                      className="rounded px-1.5 py-0.5 text-[10px] font-medium text-text-secondary hover:bg-surface-elevated"
                    >
                      Principal
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void remove(img)}
                    className="rounded px-1.5 py-0.5 text-[10px] font-medium text-danger hover:bg-danger/10"
                  >
                    Quitar
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
