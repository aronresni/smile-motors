import { ROLES } from "@/lib/constants";
import type { Profile } from "@/types/auth";

export interface SellerIdentity {
  firstName: string;
  fullName: string;
  initials: string;
  roleLabel: string;
  email: string | null;
}

const ROLE_LABELS: Record<string, string> = {
  [ROLES.SELLER]: "Vendedor",
  [ROLES.ADMIN]: "Administrador",
};

/** Deriva los datos de presentación del vendedor a partir del perfil real. */
export function deriveSellerIdentity(profile: Profile): SellerIdentity {
  const fromEmail = profile.email?.split("@")[0] ?? "";
  const fullName = (profile.full_name ?? fromEmail ?? "Vendedor").trim();
  const parts = fullName.split(/\s+/).filter(Boolean);

  const firstName = parts[0] ?? "Vendedor";
  const initials =
    parts.length >= 2
      ? `${parts[0][0]}${parts[parts.length - 1][0]}`
      : (parts[0]?.slice(0, 2) ?? "V");

  return {
    firstName,
    fullName,
    initials: initials.toUpperCase(),
    roleLabel: ROLE_LABELS[profile.role] ?? "Vendedor",
    email: profile.email,
  };
}

/** Saludo según la hora. Se resuelve en el servidor y se pasa como prop. */
export function sellerGreeting(date: Date = new Date()): string {
  const h = date.getHours();
  if (h < 12) return "Buenos días";
  if (h < 19) return "Buenas tardes";
  return "Buenas noches";
}
