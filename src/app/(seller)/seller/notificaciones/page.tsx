import type { Metadata } from "next";
import { requireZone } from "@/lib/auth/session";
import { ROUTES } from "@/lib/constants";
import { listNotifications } from "@/lib/notifications/server";
import { NotificationList } from "@/components/notifications/notification-list";
import { PushToggle } from "@/components/notifications/push-toggle";
import { vapidPublicKey } from "@/lib/push/transport";

export const metadata: Metadata = { title: "Notificaciones" };
export const dynamic = "force-dynamic";

export default async function SellerNotificacionesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { profile } = await requireZone("seller", ROUTES.sellerNotificaciones);
  const sp = await searchParams;
  const unreadOnly = sp.filtro === "no-leidas";
  const page = Number(Array.isArray(sp.pagina) ? sp.pagina[0] : sp.pagina) || 1;
  const result = await listNotifications(profile.id, { page, unreadOnly });

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand">Tu cuenta</p>
        <h1 className="text-xl font-semibold tracking-tight">Notificaciones</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Lo que administración hizo con tus ventas, contratos, ediciones y liquidaciones.
        </p>
      </div>
      <PushToggle vapidPublicKey={vapidPublicKey()} />
      <NotificationList
        basePath={ROUTES.sellerNotificaciones}
        items={result.items}
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
        unreadOnly={unreadOnly}
      />
    </div>
  );
}
