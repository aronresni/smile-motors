"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Enlace de invitación listo para entregar al vendedor. Es de un solo uso:
 * al abrirlo crea su contraseña y su cuenta queda activa. No se guarda en
 * ningún sitio — si se pierde, se genera otro con "Reenviar invitación".
 */
export function InviteLinkBox({
  url,
  phone,
  className,
}: {
  url: string;
  /** Teléfono del vendedor, para el atajo de WhatsApp (opcional). */
  phone?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // Sin permiso de portapapeles: el enlace está a la vista para copiarlo a mano.
      setCopied(false);
    }
  };

  const message = `Hola, te damos acceso a Smile Motors. Abre este enlace para crear tu contraseña y entrar: ${url}`;
  const digits = (phone ?? "").replace(/\D/g, "");
  const whatsapp = digits
    ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}`
    : `https://wa.me/?text=${encodeURIComponent(message)}`;

  return (
    <div className={className}>
      <p className="mb-1.5 text-xs font-medium text-text-secondary">
        Enlace para el vendedor
      </p>
      <p
        data-testid="invite-link"
        className="break-all rounded-lg border border-border bg-surface-muted px-3 py-2 font-mono text-[11px] text-foreground"
      >
        {url}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => void copy()}>
          {copied ? "¡Copiado!" : "Copiar enlace"}
        </Button>
        <a
          href={whatsapp}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-9 items-center rounded-lg border border-border-strong px-3 text-xs font-medium text-text-secondary hover:bg-surface-muted hover:text-foreground"
        >
          Enviar por WhatsApp
        </a>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Sirve una sola vez y caduca: si el vendedor no lo usa a tiempo, pulsa
        &quot;Reenviar invitación&quot; en su ficha para generar otro.
      </p>
    </div>
  );
}
