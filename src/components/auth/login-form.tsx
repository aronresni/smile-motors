"use client";

import { startTransition, useActionState, useEffect, useId, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useSearchParams } from "next/navigation";
import { loginSchema, type LoginInput } from "@/validations";
import { loginAction, type LoginState } from "@/app/(auth)/login/actions";
import { PasswordInput } from "@/components/auth/password-input";
import { Button } from "@/components/ui/button";
import { AlertCircleIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

const initialState: LoginState = { error: null };

/** Errores que llegan por querystring desde el proxy / callbacks. Nunca el
 * error técnico de Supabase. */
function messageForUrlError(code: string | null): string | null {
  switch (code) {
    case "no_access":
      return "Tu cuenta no está habilitada. Contacta a un administrador.";
    case "session_expired":
      return "Tu sesión expiró. Inicia sesión nuevamente.";
    case "auth_callback_failed":
      return "El enlace no es válido o ya expiró. Inicia sesión o pide uno nuevo.";
    default:
      return null;
  }
}

export const authFieldClass =
  "h-12 w-full rounded-xl border bg-surface px-3.5 text-[15px] text-foreground placeholder:text-muted-foreground/70 outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 sm:text-sm";

export function LoginForm() {
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") ?? "";
  const urlError = messageForUrlError(searchParams.get("error"));

  const [state, formAction, pending] = useActionState(loginAction, initialState);
  const [remember, setRemember] = useState(true);
  const lastHandledError = useRef<LoginState | null>(null);

  const emailId = useId();
  const passwordId = useId();
  const formErrorId = useId();

  const {
    register,
    handleSubmit,
    setFocus,
    setValue,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    mode: "onTouched",
    defaultValues: { email: "", password: "" },
  });

  // Foco inicial en el correo (el usuario puede escribir de inmediato).
  useEffect(() => {
    setFocus("email");
  }, [setFocus]);

  // Credenciales rechazadas: se limpia la contraseña y vuelve el foco a ella.
  useEffect(() => {
    if (state.error && lastHandledError.current !== state) {
      lastHandledError.current = state;
      setValue("password", "");
      setFocus("password");
    }
  }, [state, setFocus, setValue]);

  const emailError = errors.email?.message ?? state.fieldErrors?.email;
  const passwordError = errors.password?.message ?? state.fieldErrors?.password;
  const formError = state.error ?? urlError;

  const onSubmit = (values: LoginInput) => {
    if (pending) return;
    const data = new FormData();
    data.set("email", values.email.trim().toLowerCase());
    data.set("password", values.password);
    if (remember) data.set("remember", "on");
    if (redirectTo) data.set("redirectTo", redirectTo);
    startTransition(() => formAction(data));
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="space-y-5"
      aria-describedby={formError ? formErrorId : undefined}
    >
      {formError && (
        <div
          id={formErrorId}
          role="alert"
          className="flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger-surface px-3.5 py-3 text-sm text-danger"
        >
          <AlertCircleIcon size={18} className="mt-px shrink-0" />
          <span>{formError}</span>
        </div>
      )}

      <div className="space-y-1.5">
        <label htmlFor={emailId} className="block text-sm font-medium text-text-secondary">
          Correo electrónico
        </label>
        <input
          {...register("email")}
          id={emailId}
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          placeholder="nombre@smilemotors.com"
          disabled={pending}
          aria-invalid={emailError ? true : undefined}
          aria-describedby={emailError ? `${emailId}-error` : undefined}
          className={cn(authFieldClass, emailError ? "border-danger" : "border-border-strong")}
        />
        {emailError && (
          <p id={`${emailId}-error`} className="text-xs text-danger">
            {emailError}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <label htmlFor={passwordId} className="block text-sm font-medium text-text-secondary">
          Contraseña
        </label>
        <PasswordInput
          {...register("password")}
          id={passwordId}
          autoComplete="current-password"
          enterKeyHint="go"
          placeholder="Tu contraseña"
          disabled={pending}
          invalid={Boolean(passwordError)}
          aria-describedby={passwordError ? `${passwordId}-error` : undefined}
        />
        {passwordError && (
          <p id={`${passwordId}-error`} className="text-xs text-danger">
            {passwordError}
          </p>
        )}
      </div>

      <label className="flex w-fit cursor-pointer items-center gap-2.5 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
          className="h-4 w-4 rounded border-border"
          style={{ accentColor: "var(--brand)" }}
        />
        Mantener sesión iniciada
      </label>

      <Button
        type="submit"
        variant="primary"
        size="lg"
        loading={pending}
        loadingText="INICIANDO SESIÓN…"
        className="w-full uppercase"
      >
        Iniciar sesión
      </Button>
    </form>
  );
}
