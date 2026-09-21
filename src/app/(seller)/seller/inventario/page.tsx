import { redirect } from "next/navigation";
import { ROUTES } from "@/lib/constants";

/**
 * La antigua pestaña "Stock" (inventario físico con VIN y cantidades) ya no
 * existe. Los enlaces viejos llevan ahora al catálogo del vendedor, que es lo
 * que "stock" significa hoy: lo que se puede vender.
 */
export default function SellerInventarioRetiradoPage() {
  redirect(ROUTES.sellerStock);
}
