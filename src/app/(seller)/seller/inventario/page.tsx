import { redirect } from "next/navigation";
import { ROUTES } from "@/lib/constants";

/** Sin gestión de stock físico: la antigua pestaña "Stock" lleva al inicio. */
export default function SellerInventarioRetiradoPage() {
  redirect(ROUTES.seller);
}
