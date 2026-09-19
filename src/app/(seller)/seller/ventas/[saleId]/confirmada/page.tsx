import { redirect } from "next/navigation";
import { ROUTES } from "@/lib/constants";

/**
 * Ruta heredada del flujo anterior (confirmación automática). Ahora una
 * venta pasa por PENDING antes de SOLD, así que no existe un momento de
 * "éxito inmediato" propio: la ficha operativa en `/seller/ventas/[saleId]`
 * ya se adapta al estado real (PENDING/SOLD/PAID). Se conserva esta ruta
 * solo para no romper enlaces antiguos.
 */
export default async function VentaConfirmadaLegacyRedirect({
  params,
}: {
  params: Promise<{ saleId: string }>;
}) {
  const { saleId } = await params;
  redirect(`${ROUTES.sellerVentas}/${saleId}`);
}
