"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { invitationWhatsAppText } from "@/lib/invitations/invitation-email";
import { retrySellerInvitationEmail } from "@/app/(admin)/admin/vendedores/actions";

export type InviteEmailStatus = "SENT" | "FAILED" | "SKIPPED";

function emailNotice(status: InviteEmailStatus | undefined, code: string | undefined) {
  if (status === "SENT") {
    return { tone: "success" as const, title: "Invitación enviada por correo.", detail: null };
  }
  if (status === "FAILED") {
    return {
      tone: "warning" as const,
      title: "Invitación creada, pero no pudimos enviar el correo.",
      detail:
        code === "NOT_CONFIGURED"
          ? "El envío de correos todavía no está configurado. Comparte el enlace por WhatsApp o cópialo."
          : code?.startsWith("resend:")
            ? "El servicio de correo rechazó el envío. Puedes reintentarlo o compartir el enlace."
            : "Puedes reintentarlo o compartir el enlace.",
    };
  }
  if (status === "SKIPPED" && code === "EMAIL_COOLDOWN") {
    return {
      tone: "info" as const,
      title: "El correo ya se envió o se está enviando.",
      detail: "Espera unos segundos antes de volver a intentarlo.",
    };
  }
  if (status === "SKIPPED" && code === "STALE_LINK") {
    return {
      tone: "warning" as const,
      title: "Este enlace ya no es el vigente.",
      detail: "Usa “Reenviar invitación” en la ficha del vendedor para generar uno nuevo.",
    };
  }
  if (status === "SKIPPED") {
    return { tone: "warning" as const, title: "No pudimos enviar el correo.", detail: "Puedes compartir el enlace." };
  }
  return null;
}

const TONE: Record<"success" | "warning" | "info", string> = {
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  info: "bg-info/10 text-info",
};

/**
 * Enlace de invitación listo para entregar al vendedor, con el estado del
 * correo (Resend). Correo, "Copiar enlace" y WhatsApp llevan SIEMPRE el mismo
 * enlace — de un solo uso: al abrirlo crea su contraseña y su cuenta queda
 * activa. No se guarda en ningún sitio; si se pierde, "Reenviar invitación"
 * genera otro (y anula este).
 */
export function InviteLinkBox({
  url,
  sellerId,
  firstName,
  phone,
  emailStatus,
  emailCode,
  className,
}: {
  url: string;
  sellerId: string;
  firstName: string;
  /** Teléfono del vendedor, para el atajo de WhatsApp (opcional). */
  phone?: string;
  emailStatus?: InviteEmailStatus;
  emailCode?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<InviteEmailStatus | undefined>(emailStatus);
  const [code, setCode] = useState<string | undefined>(emailCode);
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);

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

  const retryEmail = async () => {
    // Un clic = un envío: el ref corta el segundo clic de un doble clic
    // antes de que React vuelva a renderizar (el servidor también bloquea).
    if (inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    try {
      const res = await retrySellerInvitationEmail(sellerId, url);
      const nextStatus = (res.ok ? res.emailStatus : "SKIPPED") as InviteEmailStatus;
      const nextCode = (res.ok ? res.emailCode : res.code) as string | undefined;
      setStatus(nextStatus);
      setCode(nextCode);
      if (nextStatus === "SENT") toast.success("Invitación enviada por correo.");
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  };

  const digits = (phone ?? "").replace(/\D/g, "");
  const message = encodeURIComponent(invitationWhatsAppText(firstName, url));
  const whatsapp = digits ? `https://wa.me/${digits}?text=${message}` : `https://wa.me/?text=${message}`;
  const notice = emailNotice(status, code);

  return (
    <div className={className}>
      {notice && (
        <div role="status" data-testid="invite-email-status" className={cn("mb-3 rounded-lg px-3 py-2 text-sm", TONE[notice.tone])}>
          <p className="font-medium">{notice.title}</p>
          {notice.detail && <p className="mt-0.5 text-xs opacity-90">{notice.detail}</p>}
        </div>
      )}
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
        <Button
          variant="secondary"
          size="sm"
          disabled={sending}
          onClick={() => void retryEmail()}
        >
          {sending ? "Enviando…" : status === "SENT" ? "Reenviar correo" : "Reintentar correo"}
        </Button>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Sirve una sola vez y caduca: si el vendedor no lo usa a tiempo, pulsa
        &quot;Reenviar invitación&quot; en su ficha para generar otro.
      </p>
    </div>
  );
}
