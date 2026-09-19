import type { ReactNode } from "react";
import { AuthShell } from "@/components/auth/auth-shell";

/** Pantallas de acceso con la identidad Smile Motors (un único login). */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return <AuthShell>{children}</AuthShell>;
}
