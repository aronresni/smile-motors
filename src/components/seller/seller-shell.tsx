import type { ReactNode } from "react";
import { BfcacheGuard } from "@/components/auth/bfcache-guard";
import { SellerHeader } from "@/components/seller/seller-header";
import { SellerSidebar } from "@/components/seller/seller-sidebar";
import { SellerBottomNav } from "@/components/seller/seller-bottom-nav";
import type { SellerIdentity } from "@/lib/seller/identity";

interface SellerShellProps {
  seller: SellerIdentity;
  dealerName: string;
  greeting: string;
  children: ReactNode;
}

/**
 * Shell persistente de /seller/*.
 *
 * - Tema oscuro forzado (`.theme-dark`) → identidad propia del área.
 * - Riel lateral en escritorio, barra inferior en móvil/tablet.
 * - Header pegajoso con contexto del vendedor.
 * - Espaciado inferior suficiente para no quedar bajo la barra fija.
 */
export function SellerShell({
  seller,
  dealerName,
  greeting,
  children,
}: SellerShellProps) {
  return (
    <div className="theme-dark min-h-svh bg-background text-foreground">
      <BfcacheGuard />
      <SellerSidebar />

      <div className="lg:pl-64">
        <SellerHeader
          seller={seller}
          dealerName={dealerName}
          greeting={greeting}
        />

        <main className="mx-auto w-full max-w-6xl px-4 pt-5 pb-[calc(6.5rem+env(safe-area-inset-bottom))] lg:px-8 lg:pt-6 lg:pb-12">
          {children}
        </main>
      </div>

      <SellerBottomNav />
    </div>
  );
}
