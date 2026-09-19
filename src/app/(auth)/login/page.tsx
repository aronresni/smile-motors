import { Suspense } from "react";
import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/login-form";
import { LockIcon } from "@/components/ui/icons";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = {
  title: "Iniciar sesión",
};

/**
 * ÚNICO login de la aplicación. Admin y vendedores entran por aquí; el rol se
 * lee del perfil en el servidor y cada uno llega a su zona (/admin o /seller).
 */
export default function LoginPage() {
  return (
    <div className="w-full">
      <div className="mb-7 space-y-1.5 text-center lg:text-left">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-brand">
          Smile Motors
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Iniciar sesión
        </h1>
        <p className="text-sm text-muted-foreground">
          Accede a tu cuenta para continuar.
        </p>
      </div>

      <Suspense fallback={<FormSkeleton />}>
        <LoginForm />
      </Suspense>

      {/* No existe todavía un flujo de restablecimiento por correo: se indica
          el canal real en vez de inventar un enlace que no funciona. */}
      <p className="mt-6 text-center text-xs leading-relaxed text-muted-foreground lg:text-left">
        ¿Olvidaste tu contraseña? Pide a un administrador que restablezca tu acceso.
      </p>

      <p className="mt-8 flex items-center justify-center gap-1.5 text-xs text-muted-foreground lg:justify-start">
        <LockIcon size={13} />
        Acceso seguro · Uso interno
      </p>
    </div>
  );
}

function FormSkeleton() {
  return (
    <div className="space-y-5" aria-hidden="true">
      <div className="space-y-1.5">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-12 w-full" />
      </div>
      <div className="space-y-1.5">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-12 w-full" />
      </div>
      <Skeleton className="h-12 w-full" />
    </div>
  );
}
