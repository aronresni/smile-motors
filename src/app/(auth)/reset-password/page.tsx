import { redirect } from "next/navigation";
import { ROUTES } from "@/lib/constants";

/**
 * App privada con UN SOLO acceso: no hay registro público ni restablecimiento
 * de contraseña por correo implementado todavía (las cuentas las invita un
 * administrador). Esta ruta redirige al login único en vez de mostrar una
 * pantalla a medio hacer.
 */
export default function Page() {
  redirect(ROUTES.login);
}
