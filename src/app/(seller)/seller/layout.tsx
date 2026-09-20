import type { ReactNode } from "react";
import { requireZone } from "@/lib/auth/session";
import { deriveSellerIdentity, sellerGreeting } from "@/lib/seller/identity";
import { SellerShell } from "@/components/seller/seller-shell";
import { DEALER } from "@/config/dealer";
import { ROUTES } from "@/lib/constants";
import { getUnreadNotificationCount } from "@/lib/notifications/server";
import { NotificationsProvider } from "@/components/notifications/notifications-provider";

// Zona protegida: nunca cachear.
export const dynamic = "force-dynamic";

export default async function SellerLayout({
  children,
}: {
  children: ReactNode;
}) {
  // 2.º nivel de protección (además del proxy): valida sesión + rol en servidor.
  const { profile } = await requireZone("seller", ROUTES.seller);
  const seller = deriveSellerIdentity(profile);
  const unreadNotifications = await getUnreadNotificationCount();

  return (
    <NotificationsProvider userId={profile.id} zone="seller" initialUnread={unreadNotifications}>
      <SellerShell
        seller={seller}
        dealerName={DEALER.name}
        greeting={sellerGreeting()}
      >
        {children}
      </SellerShell>
    </NotificationsProvider>
  );
}
