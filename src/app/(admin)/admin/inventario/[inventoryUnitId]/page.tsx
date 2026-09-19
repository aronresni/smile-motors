import { redirect } from "next/navigation";
import { ROUTES } from "@/lib/constants";

/**
 * La app ya no gestiona VIN ni stock físico: el antiguo módulo de Inventario
 * se retiró. Enlaces viejos → catálogo de Productos (datos históricos de VIN
 * conservados en la base como legado inactivo).
 */
export default function InventarioRetiradoPage() {
  redirect(ROUTES.adminProductos);
}
