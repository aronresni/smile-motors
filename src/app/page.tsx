import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { homeForRole } from "@/lib/auth/access";
import { ROUTES } from "@/lib/constants";

export const dynamic = "force-dynamic";

/** Raíz: una sola puerta de entrada. Con sesión → zona del rol; sin sesión →
 * el login único. */
export default async function Home() {
  const ctx = await getAuthContext();
  redirect(ctx ? homeForRole(ctx.profile.role) : ROUTES.login);
}
