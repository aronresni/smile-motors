/**
 * Correo de invitación de vendedores — contenido (puro, sin dependencias).
 *
 * HTML conservador para clientes de correo: tablas, estilos en línea, sin
 * web fonts ni CSS externo. Marca Smile Motors: negro, amarillo y blanco.
 * NUNCA incluye contraseñas ni identificadores internos: solo el nombre de
 * pila y el enlace de activación (el mismo que se copia o se manda por
 * WhatsApp).
 */
export const INVITATION_EMAIL_SUBJECT = "Smile Motors te invitó a crear tu cuenta";

const BLACK = "#0a0a0a";
const YELLOW = "#ffd400";
const WHITE = "#ffffff";

export interface InvitationEmailInput {
  firstName: string;
  inviteUrl: string;
  /** URL pública (https) del logo apto para correo; si falta, se usa texto. */
  logoUrl?: string | null;
}

export interface InvitationEmail {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Nombre de pila a partir del nombre completo del perfil. */
export function firstNameOf(fullName: string | null | undefined): string {
  return (fullName ?? "").trim().split(/\s+/)[0] ?? "";
}

export function buildInvitationEmail({ firstName, inviteUrl, logoUrl }: InvitationEmailInput): InvitationEmail {
  const name = firstName.trim();
  const greeting = name ? `Hola ${name},` : "Hola,";
  const url = escapeHtml(inviteUrl);
  const logo = logoUrl?.startsWith("https://")
    ? `<img src="${escapeHtml(logoUrl)}" width="120" height="120" alt="Smile Motors" style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;" />`
    : `<span style="font-family:Arial,Helvetica,sans-serif;font-size:26px;font-weight:800;letter-spacing:2px;color:${YELLOW};">SMILE</span><br /><span style="font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:700;letter-spacing:6px;color:${WHITE};">MOTORS</span>`;

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light only" />
<title>${escapeHtml(INVITATION_EMAIL_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f2f2f2;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f2f2f2;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background-color:${WHITE};border-radius:12px;overflow:hidden;">
<tr><td align="center" bgcolor="${BLACK}" style="background-color:${BLACK};padding:28px 24px;">${logo}</td></tr>
<tr><td height="4" bgcolor="${YELLOW}" style="background-color:${YELLOW};font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:32px 32px 8px 32px;font-family:Arial,Helvetica,sans-serif;color:${BLACK};">
<p style="margin:0 0 16px 0;font-size:18px;font-weight:bold;">${escapeHtml(greeting)}</p>
<p style="margin:0 0 12px 0;font-size:15px;line-height:22px;">Has sido invitado a formar parte del equipo de Smile Motors.</p>
<p style="margin:0 0 24px 0;font-size:15px;line-height:22px;">Crea tu contraseña para activar tu cuenta.</p>
</td></tr>
<tr><td align="center" style="padding:0 32px 28px 32px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td align="center" bgcolor="${YELLOW}" style="background-color:${YELLOW};border-radius:8px;">
<a href="${url}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;letter-spacing:1px;color:${BLACK};text-decoration:none;">ACTIVAR MI CUENTA</a>
</td></tr></table>
</td></tr>
<tr><td style="padding:0 32px 24px 32px;font-family:Arial,Helvetica,sans-serif;color:#444444;font-size:13px;line-height:20px;">
<p style="margin:0 0 12px 0;">Este enlace es personal, temporal y de un solo uso.</p>
<p style="margin:0 0 12px 0;">Si el botón no funciona, copia y pega este enlace en tu navegador:</p>
<p style="margin:0;word-break:break-all;"><a href="${url}" target="_blank" style="color:${BLACK};">${url}</a></p>
</td></tr>
<tr><td bgcolor="${BLACK}" style="background-color:${BLACK};padding:16px 32px;font-family:Arial,Helvetica,sans-serif;color:#bbbbbb;font-size:12px;line-height:18px;">
Si no esperabas esta invitación, puedes ignorar este correo.
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    "SMILE MOTORS",
    "",
    greeting,
    "",
    "Has sido invitado a formar parte del equipo de Smile Motors.",
    "Crea tu contraseña para activar tu cuenta:",
    "",
    inviteUrl,
    "",
    "Este enlace es personal, temporal y de un solo uso.",
    "",
    "Si no esperabas esta invitación, puedes ignorar este correo.",
  ].join("\n");

  return { subject: INVITATION_EMAIL_SUBJECT, html, text };
}

/** Mensaje prellenado para compartir el MISMO enlace por WhatsApp. */
export function invitationWhatsAppText(firstName: string, inviteUrl: string): string {
  const name = firstName.trim();
  return [
    `${name ? `Hola ${name}` : "Hola"}, te invitamos a crear tu cuenta de vendedor de Smile Motors.`,
    "",
    "Activa tu cuenta desde este enlace:",
    "",
    inviteUrl,
  ].join("\n");
}
