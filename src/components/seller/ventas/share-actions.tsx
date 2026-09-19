"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fallback abajo */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function whatsappShare(text: string) {
  const nav = navigator as Navigator & {
    share?: (data: { text: string }) => Promise<void>;
  };
  if (typeof nav.share === "function") {
    nav.share({ text }).catch(() => {
      window.open(
        `https://wa.me/?text=${encodeURIComponent(text)}`,
        "_blank",
        "noopener,noreferrer",
      );
    });
    return;
  }
  window.open(
    `https://wa.me/?text=${encodeURIComponent(text)}`,
    "_blank",
    "noopener,noreferrer",
  );
}

/** Botón compacto de copiar (para códigos de tracking, etc.). */
export function CopyButton({
  text,
  label = "Copiar",
  className,
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true);
          window.setTimeout(() => setDone(false), 1500);
        }
      }}
      className={cn(
        "inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-medium text-text-secondary transition-colors hover:text-foreground",
        className,
      )}
      aria-label={`${label}: ${text}`}
    >
      {done ? "Copiado" : label}
    </button>
  );
}

/** Copiar + WhatsApp para un bloque de mensaje. */
export function ShareActions({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="secondary"
        size="sm"
        onClick={async () => {
          if (await copyText(text)) {
            setDone(true);
            window.setTimeout(() => setDone(false), 1600);
          }
        }}
      >
        {done ? "Copiado" : "Copiar"}
      </Button>
      <Button variant="primary" size="sm" onClick={() => whatsappShare(text)}>
        WhatsApp
      </Button>
    </div>
  );
}
