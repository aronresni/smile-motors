import type { Metadata } from "next";
import { requireZone } from "@/lib/auth/session";
import { ROUTES } from "@/lib/constants";
import { listNotifications } from "@/lib/notifications/server";
import { NotificationList } from "@/components/notifications/notification-list";
import { PushToggle } from "@/components/notifications/push-toggle";
import { vapidPublicKey } from "@/lib/push/transport";

export const metadata: Metadata = { title: "Notificaciones · Admin" };
export const dynamic = "force-dynamic";

export default async function AdminNotificacionesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { profile } = await requireZone("admin", ROUTES.adminNotificaciones);
  const sp = await searchParams;
  const unreadOnly = sp.filtro === "no-leidas";
  const page = Number(Array.isArray(sp.pagina) ? sp.pagina[0] : sp.pagina) || 1;
  const result = await listNotifications(profile.id, { page, unreadOnly });

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Notificaciones</h1>
        <p className="text-sm text-muted-foreground">
          Avisos personales para ti: ventas enviadas o confirmadas por vendedores, solicitudes de edición y
          vendedores que activan su cuenta. Son distintas de Actividad y Alertas, que son del concesionario.
        </p>
      </div>
      <PushToggle vapidPublicKey={vapidPublicKey()} />
      <NotificationList
        basePath={ROUTES.adminNotificaciones}
        items={result.items}
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
        unreadOnly={unreadOnly}
      />
    </div>
  );
}
