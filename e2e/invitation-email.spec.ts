import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import type { Database } from "../src/types/database.types";
import { generateInviteLink } from "../src/lib/invitations/invite-link-core";
import {
  deliverInvitationEmail,
  type InvitationMailer,
  type InvitationMessage,
} from "../src/lib/invitations/deliver-invitation-email";
import { INVITATION_EMAIL_SUBJECT } from "../src/lib/invitations/invitation-email";
import { E2E_PASSWORD } from "./credentials";

/**
 * CORREO DE INVITACIÓN (Resend) — canal adicional sobre la invitación por
 * enlace que ya funciona en producción.
 *
 *  · Servicio: base REAL, enlace REAL (generateLink) con el dominio de
 *    PRODUCCIÓN y un transporte de CAPTURA en lugar de Resend (no hay clave
 *    de Resend en este equipo): prueba qué se envía, a quién, con qué enlace
 *    y qué queda registrado. El enlace del correo se abre en un navegador
 *    real contra producción (crear contraseña → ACTIVE → login normal).
 *  · Interfaz: servidor local SIN `RESEND_API_KEY` → el correo falla
 *    (NOT_CONFIGURED) y la invitación sigue en pie con Copiar / WhatsApp /
 *    Reintentar correo. Un vendedor que reproduce la acción del admin es
 *    rechazado.
 *
 * Cada prueba borra las cuentas e invitaciones que crea.
 */

const PROD = "https://smile-motors-beta.vercel.app";
const ADMIN_EMAIL = "e2e-smile-admin@motods.test";
const SELLER_EMAIL = "e2e-smile-seller@motods.test";

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

type Db = SupabaseClient<Database>;
let svc: Db;
let admin: Db;
let seller: Db;
const created: string[] = [];

async function signIn(email: string): Promise<Db> {
  const c = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });
  const { error } = await c.auth.signInWithPassword({ email, password: E2E_PASSWORD });
  if (error) throw error;
  return c;
}

/** Transporte de captura: registra lo que se enviaría por Resend. */
function captureMailer(fail?: string): InvitationMailer & { sent: InvitationMessage[] } {
  const sent: InvitationMessage[] = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
      return fail ? { ok: false, error: fail } : { ok: true, id: `capture-${sent.length}` };
    },
  };
}

/** Invitación exactamente como la crea la Server Action (sin el correo). */
async function invite(email: string, fullName: string) {
  created.push(email);
  const res = await generateInviteLink(svc, PROD, email, {
    full_name: fullName,
    role: "seller",
    account_status: "INVITED",
  });
  if (!res.ok) throw new Error(`generateLink: ${res.code}`);
  const { data } = await admin.rpc("admin_record_seller_invitation", {
    p_seller_id: res.link.userId,
    p_email: email,
    p_link_digest: res.link.digest,
  });
  expect((data as { ok?: boolean }).ok).toBe(true);
  return res.link;
}

async function invitationRow(sellerId: string) {
  const { data } = await svc
    .from("seller_invitations")
    .select("*")
    .eq("invited_user_id", sellerId);
  return data ?? [];
}

async function events(sellerId: string, type: string) {
  const { data } = await svc.from("seller_account_events").select("reason").eq("seller_id", sellerId).eq("event_type", type);
  return data ?? [];
}

const tokenOf = (url: string) => new URL(url).searchParams.get("token_hash")!;

test.beforeAll(async () => {
  svc = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  admin = await signIn(ADMIN_EMAIL);
  seller = await signIn(SELLER_EMAIL);
});

test.afterAll(async () => {
  const { data } = await svc.auth.admin.listUsers({ perPage: 200 });
  for (const email of created) {
    await svc.from("seller_invitations").delete().eq("email", email);
    const u = data.users.find((x) => x.email === email);
    if (u) await svc.auth.admin.deleteUser(u.id);
  }
});

test.describe("Servicio — correo con el MISMO enlace de la invitación", () => {
  const stamp = Date.now().toString(36);
  const emailOk = `e2e-correo-ok-${stamp}@motods.test`;
  let okLink: Awaited<ReturnType<typeof invite>>;
  let okMail: ReturnType<typeof captureMailer>;

  test("1 · invitar: una invitación, una cuenta, correo ENVIADO con el enlace de producción", async () => {
    okLink = await invite(emailOk, "Correo Prueba");
    okMail = captureMailer();
    const result = await deliverInvitationEmail(admin, okMail, {
      sellerId: okLink.userId,
      inviteUrl: okLink.url,
      linkDigest: okLink.digest,
      siteUrl: PROD,
    });
    expect(result).toEqual({ status: "SENT" });

    // Una cuenta de Auth y una invitación, con la entrega registrada.
    const { data: users } = await svc.auth.admin.listUsers({ perPage: 200 });
    expect(users.users.filter((u) => u.email === emailOk)).toHaveLength(1);
    const rows = await invitationRow(okLink.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "PENDING", email_delivery_status: "SENT", email_attempts: 1, email_last_error: null });
    expect(rows[0].email_sent_at).not.toBeNull();
    expect(await events(okLink.userId, "INVITATION_EMAIL_SENT")).toHaveLength(1);

    // El correo "enviado" NO activa la cuenta.
    const { data: profile } = await svc.from("profiles").select("account_status, is_active").eq("id", okLink.userId).single();
    expect(profile).toMatchObject({ account_status: "INVITED", is_active: false });

    // Contenido: destinatario desde la base, asunto, enlace EXACTO de producción.
    expect(okMail.sent).toHaveLength(1);
    const [msg] = okMail.sent;
    expect(msg.to).toBe(emailOk);
    expect(msg.subject).toBe(INVITATION_EMAIL_SUBJECT);
    expect(okLink.url.startsWith(`${PROD}/auth/invitacion?token_hash=`)).toBe(true);
    expect(msg.html).toContain(`href="${okLink.url}"`);
    expect(msg.text).toContain(okLink.url);
    expect(msg.html).toContain("ACTIVAR MI CUENTA");
    expect(msg.html).toContain("Hola Correo,");
    expect(msg.html).toContain("personal, temporal y de un solo uso");
    expect(msg.html).toContain(`src="${PROD}/brand/smile-motors-logo-email.png"`);
    // Nunca contraseñas ni identificadores internos.
    expect(msg.html).not.toContain(okLink.userId);
    expect(msg.html).not.toContain(rows[0].id);
    expect(msg.html).not.toContain(okLink.digest);
    expect(msg.html).not.toContain(E2E_PASSWORD);
    expect(msg.html.toLowerCase()).not.toMatch(/contraseña:\s*\S/);
  });

  test("1b · ABRIR el enlace no lo gasta: la vista previa de WhatsApp ya no quema la invitación", async ({ request }) => {
    // Lo que hace WhatsApp (y cualquier escáner de correo) al recibir el
    // enlace: descargarlo por su cuenta para armar la vista previa. Antes eso
    // canjeaba el token y la persona recibía "este enlace ya se usó".
    const preview = await request.get(okLink.url, {
      headers: { "user-agent": "WhatsApp/2.24.7.78 A" },
    });
    expect(preview.ok()).toBe(true);
    expect(await preview.text()).toContain("Activa tu cuenta");
    await request.head(okLink.url);

    // La cuenta sigue SIN confirmar y sin sesión: nadie canjeó nada.
    const { data } = await svc.auth.admin.getUserById(okLink.userId);
    expect(data.user?.email_confirmed_at ?? null).toBeNull();
    expect(data.user?.last_sign_in_at ?? null).toBeNull();
    expect((await invitationRow(okLink.userId))[0].status).not.toBe("ACCEPTED");
  });

  test("2 + 5 · el enlace DEL CORREO, abierto en producción: crea contraseña → ACTIVE → login normal", async ({ browser }) => {
    const url = /href="([^"]+)"/.exec(okMail.sent[0].html)![1];
    const password = `Correo-${stamp}-9x!`;
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(url);
    // El token se canjea solo cuando lo confirma la persona.
    await page.getByRole("button", { name: "Continuar" }).click();
    await page.waitForURL(`${PROD}/auth/accept-invite`, { timeout: 45_000 });
    await page.getByLabel("Nueva contraseña").fill(password);
    await page.getByLabel("Confirmar contraseña").fill(password);
    await page.getByRole("button", { name: "Activar mi cuenta" }).click();
    await page.waitForURL(`${PROD}/seller`, { timeout: 45_000 });

    const { data: profile } = await svc.from("profiles").select("account_status, is_active").eq("id", okLink.userId).single();
    expect(profile).toMatchObject({ account_status: "ACTIVE", is_active: true });
    expect((await invitationRow(okLink.userId))[0].status).toBe("ACCEPTED");

    // Login unificado de siempre.
    await page.request.post(`${PROD}/auth/signout`);
    await page.goto(`${PROD}/login`);
    await page.locator('input[type="email"]').fill(emailOk);
    await page.locator('input[type="password"]').fill(password);
    await page.getByRole("button", { name: /iniciar sesión/i }).click();
    await page.waitForURL(`${PROD}/seller`, { timeout: 45_000 });
    await ctx.close();
  });

  test("3 · el correo FALLA: la invitación y su enlace siguen válidos; queda registrado", async () => {
    const email = `e2e-correo-falla-${stamp}@motods.test`;
    const link = await invite(email, "Falla Prueba");

    const failing = captureMailer("resend:validation_error");
    const result = await deliverInvitationEmail(admin, failing, {
      sellerId: link.userId, inviteUrl: link.url, linkDigest: link.digest, siteUrl: PROD,
    });
    expect(result).toEqual({ status: "FAILED", code: "resend:validation_error" });
    let [row] = await invitationRow(link.userId);
    expect(row).toMatchObject({ status: "PENDING", email_delivery_status: "FAILED", email_last_error: "resend:validation_error" });
    expect((await events(link.userId, "INVITATION_EMAIL_FAILED"))[0].reason).toBe("resend:validation_error");

    // Sin Resend configurado: FAILED NOT_CONFIGURED (tras un fallo se puede reintentar ya).
    const notConfigured = await deliverInvitationEmail(admin, null, {
      sellerId: link.userId, inviteUrl: link.url, linkDigest: link.digest, siteUrl: PROD,
    });
    expect(notConfigured).toEqual({ status: "FAILED", code: "NOT_CONFIGURED" });
    [row] = await invitationRow(link.userId);
    expect(row).toMatchObject({ status: "PENDING", email_delivery_status: "FAILED", email_last_error: "NOT_CONFIGURED", email_attempts: 2 });

    // La cuenta sigue INVITED y el enlace (Copiar / WhatsApp) sigue sirviendo.
    const { data: profile } = await svc.from("profiles").select("account_status").eq("id", link.userId).single();
    expect(profile!.account_status).toBe("INVITED");
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    const { data: otp, error } = await anon.auth.verifyOtp({ type: "invite", token_hash: tokenOf(link.url) });
    expect(error).toBeNull();
    expect(otp.user?.email).toBe(email);
  });

  test("4 · reenviar invitación: enlace NUEVO por correo, el viejo deja de servir y nunca se envía", async () => {
    const email = `e2e-correo-reenvio-${stamp}@motods.test`;
    const first = await invite(email, "Reenvio Prueba");
    const mail = captureMailer();
    expect(await deliverInvitationEmail(admin, mail, {
      sellerId: first.userId, inviteUrl: first.url, linkDigest: first.digest, siteUrl: PROD,
    })).toEqual({ status: "SENT" });

    // Reenviar = lo mismo que la Server Action: enlace nuevo + misma fila.
    const again = await generateInviteLink(svc, PROD, email);
    if (!again.ok) throw new Error(again.code);
    const { data: touched } = await admin.rpc("admin_touch_seller_invitation", {
      p_seller_id: first.userId, p_link_digest: again.link.digest,
    });
    expect((touched as { ok?: boolean }).ok).toBe(true);
    expect(await deliverInvitationEmail(admin, mail, {
      sellerId: first.userId, inviteUrl: again.link.url, linkDigest: again.link.digest, siteUrl: PROD,
    })).toEqual({ status: "SENT" });

    expect(mail.sent).toHaveLength(2);
    expect(again.link.url).not.toBe(first.url);
    expect(mail.sent[1].html).toContain(`href="${again.link.url}"`);
    expect(mail.sent[1].html).not.toContain(tokenOf(first.url));
    const rows = await invitationRow(first.userId);
    expect(rows).toHaveLength(1); // misma invitación, nunca una segunda fila

    // Nunca se envía el enlace invalidado.
    const stale = await deliverInvitationEmail(admin, mail, {
      sellerId: first.userId, inviteUrl: first.url, linkDigest: first.digest, siteUrl: PROD,
    });
    expect(stale).toEqual({ status: "SKIPPED", code: "STALE_LINK" });
    expect(mail.sent).toHaveLength(2);

    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    const old = await anon.auth.verifyOtp({ type: "invite", token_hash: tokenOf(first.url) });
    expect(old.error).not.toBeNull();
    const fresh = await anon.auth.verifyOtp({ type: "invite", token_hash: tokenOf(again.link.url) });
    expect(fresh.error).toBeNull();
  });

  test("4b · invitación ya gastada (el enlace se abrió antes): reenviar la revive", async () => {
    // Estado real de las cuentas que quemó la vista previa de WhatsApp antes
    // de la corrección: cuenta CONFIRMADA por el canje, pero perfil todavía
    // INVITED porque nadie llegó a crear una contraseña.
    const email = `e2e-correo-gastada-${stamp}@motods.test`;
    const first = await invite(email, "Gastada Prueba");
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    expect((await anon.auth.verifyOtp({ type: "invite", token_hash: tokenOf(first.url) })).error).toBeNull();

    const { data: burned } = await svc.auth.admin.getUserById(first.userId);
    expect(burned.user?.email_confirmed_at ?? null).not.toBeNull();
    const { data: profile } = await svc.from("profiles").select("account_status").eq("id", first.userId).single();
    expect(profile!.account_status).toBe("INVITED");

    // Reenviar genera un enlace nuevo que SÍ sirve: el admin no necesita
    // borrar ni recrear la cuenta.
    const again = await generateInviteLink(svc, PROD, email);
    if (!again.ok) throw new Error(`generateLink: ${again.code}`);
    expect(again.link.url).not.toBe(first.url);
    const fresh = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    expect((await fresh.auth.verifyOtp({ type: "invite", token_hash: tokenOf(again.link.url) })).error).toBeNull();
  });

  test("doble clic / concurrencia: dos envíos simultáneos del mismo enlace → UN solo correo", async () => {
    const email = `e2e-correo-doble-${stamp}@motods.test`;
    const link = await invite(email, "Doble Prueba");
    const mail = captureMailer();
    const input = { sellerId: link.userId, inviteUrl: link.url, linkDigest: link.digest, siteUrl: PROD };
    const results = await Promise.all([
      deliverInvitationEmail(admin, mail, input),
      deliverInvitationEmail(admin, mail, input),
    ]);
    expect(results.filter((r) => r.status === "SENT")).toHaveLength(1);
    expect(results.filter((r) => r.status === "SKIPPED" && r.code === "EMAIL_COOLDOWN")).toHaveLength(1);
    expect(mail.sent).toHaveLength(1);
    // Y justo después, otro "Reenviar correo" también espera.
    expect(await deliverInvitationEmail(admin, mail, input)).toEqual({ status: "SKIPPED", code: "EMAIL_COOLDOWN" });
    expect((await invitationRow(link.userId))[0].email_attempts).toBe(1);
  });

  test("6 · un VENDEDOR no puede disparar el correo de otra cuenta (RPC)", async () => {
    const email = `e2e-correo-vendedor-${stamp}@motods.test`;
    const link = await invite(email, "Vendedor Prueba");
    const begin = await seller.rpc("admin_begin_invitation_email", { p_seller_id: link.userId, p_link_digest: link.digest });
    expect((begin.data as { code?: string }).code).toBe("NOT_ADMIN");
    const finish = await seller.rpc("admin_finish_invitation_email", {
      p_seller_id: link.userId, p_link_digest: link.digest, p_sent: true,
    });
    expect((finish.data as { code?: string }).code).toBe("NOT_ADMIN");
    const mail = captureMailer();
    expect(await deliverInvitationEmail(seller, mail, {
      sellerId: link.userId, inviteUrl: link.url, linkDigest: link.digest, siteUrl: PROD,
    })).toEqual({ status: "SKIPPED", code: "NOT_ADMIN" });
    expect(mail.sent).toHaveLength(0);
    const [row] = await invitationRow(link.userId);
    expect(row).toMatchObject({ email_attempts: 0, email_delivery_status: "PENDING" });
    expect(await events(link.userId, "INVITATION_EMAIL_SENT")).toHaveLength(0);
  });
});

async function loginUi(page: Page, email: string) {
  await page.request.post("/auth/signout");
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(E2E_PASSWORD);
  await page.getByRole("button", { name: /iniciar sesión/i }).click();
}

test.describe("Interfaz — sin Resend configurado, la invitación no se rompe", () => {
  test("3 (UI) · 'no pudimos enviar el correo' + Copiar / WhatsApp / Reintentar; el enlace sirve; un vendedor no puede reproducir la acción", async ({ page, browser }) => {
    const stamp = Date.now().toString(36);
    const email = `e2e-correo-ui-${stamp}@motods.test`;
    created.push(email);

    await loginUi(page, ADMIN_EMAIL);
    await page.waitForURL(/\/admin$/, { timeout: 30_000 });
    await page.goto("/admin/vendedores");
    await page.getByRole("button", { name: "Invitar vendedor" }).click();
    await page.getByLabel("Nombre/s").fill("Lucia");
    await page.getByLabel("Apellido/s").fill("Correo UI");
    await page.getByLabel("Correo electrónico").fill(email);
    await page.getByRole("button", { name: "Enviar invitación" }).click();

    const status = page.getByTestId("invite-email-status");
    await expect(status).toContainText("Invitación creada, pero no pudimos enviar el correo.", { timeout: 30_000 });
    await expect(status).toContainText("no está configurado");
    const url = (await page.getByTestId("invite-link").innerText()).trim();
    expect(url).toContain("/auth/invitacion?token_hash=");
    await expect(page.getByRole("button", { name: "Copiar enlace" })).toBeVisible();
    const wa = page.getByRole("link", { name: "Enviar por WhatsApp" });
    const href = decodeURIComponent((await wa.getAttribute("href"))!);
    expect(href).toContain("Hola Lucia, te invitamos a crear tu cuenta de vendedor de Smile Motors.");
    expect(href).toContain(url);

    // La invitación existe aunque el correo falló.
    const { data: profile } = await svc.from("profiles").select("id, account_status").eq("email", email).single();
    expect(profile!.account_status).toBe("INVITED");
    const sellerId = profile!.id;
    const attempts = async () => (await invitationRow(sellerId))[0].email_attempts;
    expect(await attempts()).toBe(1);

    // "Reintentar correo": un doble clic = un solo intento más.
    const retry = page.getByRole("button", { name: "Reintentar correo" });
    const actionReq = page.waitForRequest((r) => r.method() === "POST" && Boolean(r.headers()["next-action"]));
    await retry.dblclick();
    const captured = await actionReq;
    await expect(status).toContainText("no pudimos enviar el correo", { timeout: 30_000 });
    await expect(retry).toBeEnabled();
    expect(await attempts()).toBe(2);

    // 6 (UI) · un VENDEDOR reproduce la acción del admin con sus cookies → rechazado.
    const sellerCtx = await browser.newContext({ baseURL: new URL(page.url()).origin });
    const sellerPage = await sellerCtx.newPage();
    await loginUi(sellerPage, SELLER_EMAIL);
    await sellerPage.waitForURL(/\/seller$/, { timeout: 30_000 });
    const replay = await sellerPage.request.post(captured.url(), {
      headers: {
        "next-action": captured.headers()["next-action"],
        "content-type": captured.headers()["content-type"] ?? "text/plain;charset=UTF-8",
        accept: "text/x-component",
      },
      data: captured.postData() ?? "",
      maxRedirects: 0,
    });
    expect(await replay.text()).not.toContain('"emailStatus"');
    expect(await attempts()).toBe(2);
    expect(await events(sellerId, "INVITATION_EMAIL_SENT")).toHaveLength(0);
    await sellerCtx.close();

    // Control positivo: la MISMA petición con la sesión del admin sí se
    // ejecuta — el rechazo de arriba es por autorización, no por la petición.
    const adminReplay = await page.request.post(captured.url(), {
      headers: {
        "next-action": captured.headers()["next-action"],
        "content-type": captured.headers()["content-type"] ?? "text/plain;charset=UTF-8",
        accept: "text/x-component",
      },
      data: captured.postData() ?? "",
      maxRedirects: 0,
    });
    expect(await adminReplay.text()).toContain('"emailStatus"');
    expect(await attempts()).toBe(3);

    // El enlace de la pantalla sigue llevando a crear la contraseña.
    const guest = await browser.newContext({ baseURL: new URL(page.url()).origin });
    const guestPage = await guest.newPage();
    await guestPage.goto(url.replace(/^https?:\/\/[^/]+/, ""));
    await guestPage.getByRole("button", { name: "Continuar" }).click();
    await guestPage.waitForURL(/\/auth\/accept-invite$/, { timeout: 30_000 });
    await expect(guestPage.getByRole("button", { name: "Activar mi cuenta" })).toBeVisible();
    await guest.close();
  });
});
