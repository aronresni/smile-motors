import type { Metadata } from "next";
import { requireZone } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { ROUTES } from "@/lib/constants";
import { PageHeader } from "@/components/ui/page-header";
import { AdminProfileForm } from "@/components/admin/profile/admin-profile-form";
import { displayName } from "@/lib/identity/person";

export const metadata: Metadata = { title: "Mi perfil" };
export const dynamic = "force-dynamic";

/**
 * Perfil del administrador que tiene la sesión abierta.
 *
 * Existe porque la atribución necesita un nombre: sin esto, todo lo que hace
 * administración aparecería sin autor. El nombre que se guarde aquí es el que
 * verán las fichas de venta, los contratos, las liquidaciones, la actividad y
 * las notificaciones del vendedor.
 */
export default async function AdminPerfilPage() {
  const ctx = await requireZone("admin", ROUTES.adminPerfil);
  const supabase = await createClient();

  const { data } = await supabase
    .from("profiles")
    .select("first_name, last_name, display_name, full_name, phone, email, account_status")
    .eq("id", ctx.userId)
    .single();

  const preview = displayName({
    displayName: data?.display_name,
    firstName: data?.first_name,
    lastName: data?.last_name,
    fullName: data?.full_name,
  });

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader
        eyebrow="Tu cuenta"
        title="Mi perfil"
        description="Tu nombre acompaña a cada acción que hacés: aprobaciones, confirmaciones, cobros y correcciones."
      />
      <AdminProfileForm
        firstName={data?.first_name ?? ""}
        lastName={data?.last_name ?? ""}
        displayName={data?.display_name ?? ""}
        phone={data?.phone ?? ""}
        email={data?.email ?? ctx.email}
        accountStatus={data?.account_status ?? "ACTIVE"}
        preview={preview}
      />
    </div>
  );
}
