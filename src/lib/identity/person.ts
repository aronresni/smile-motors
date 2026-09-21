import { ROLES, type Role } from "@/lib/constants";

/**
 * Identidad de una persona para mostrarla en pantalla — UNA sola regla para
 * toda la app (antes había una copia en el encabezado de admin y otra en el
 * del vendedor).
 *
 * La misma regla vive en la base (`person_display_name`), para que el nombre
 * que devuelve una RPC y el que calcula la interfaz nunca se contradigan:
 *   nombre visible → nombre + apellido → nombre completo → (nada).
 *
 * Nunca cae al correo: el correo de un administrador no tiene por qué
 * aparecerle a un vendedor solo porque actuó sobre su venta.
 */

/** Lo que se muestra cuando un registro histórico no guardó a su autor. Nunca
 * se inventa una persona ni se atribuye al admin que está mirando. */
export const UNKNOWN_ACTOR = "Sin registro de autor";

export const ROLE_LABEL: Record<string, string> = {
  [ROLES.ADMIN]: "Administrador",
  [ROLES.SELLER]: "Vendedor",
};

export interface PersonNameSource {
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
}

/** Nombre visible, o `null` si de verdad no hay ninguno. */
export function displayName(person: PersonNameSource): string | null {
  const composed = [person.firstName, person.lastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
  return (
    person.displayName?.trim() ||
    composed ||
    person.fullName?.trim() ||
    null
  );
}

/** Iniciales para el avatar: "Aron Resnicoff" → "AR". */
export function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export interface Actor {
  id: string | null;
  name: string | null;
  role?: Role | string | null;
}

/** Cómo nombrar a quien hizo algo, incluido el caso honesto de no saberlo. */
export function actorLabel(actor: Pick<Actor, "name">): string {
  return actor.name?.trim() || UNKNOWN_ACTOR;
}

export function roleLabel(role: Role | string | null | undefined): string | null {
  return role ? (ROLE_LABEL[role] ?? null) : null;
}
