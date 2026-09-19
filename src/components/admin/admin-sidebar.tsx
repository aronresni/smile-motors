import Link from "next/link";
import { AdminNav } from "@/components/admin/admin-nav";
import { BrandMark } from "@/components/brand/brand-mark";
import { ROUTES } from "@/lib/constants";

/** Riel lateral del Admin (escritorio `lg:`): marca oficial + navegación. */
export function AdminSidebar({
  approvalsCount,
  alertsCount,
}: {
  approvalsCount: number;
  alertsCount: number;
}) {
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-border bg-surface lg:flex">
      <Link
        href={ROUTES.admin}
        className="flex items-center border-b border-border px-5 py-4 transition-opacity hover:opacity-90"
        aria-label="Smile Motors — Panel de administración"
      >
        <BrandMark roleLabel="Administración" size={44} priority />
      </Link>
      <div className="flex-1 overflow-y-auto px-3 py-5">
        <AdminNav approvalsCount={approvalsCount} alertsCount={alertsCount} />
      </div>
      <p className="border-t border-border px-5 py-3 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        Smile Motors · Uso interno
      </p>
    </aside>
  );
}
