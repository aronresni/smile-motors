"use client";

import { startTransition, useActionState, useId } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { resetPasswordSchema, type ResetPasswordInput } from "@/validations";
import { acceptInviteAction, type AcceptInviteState } from "@/app/auth/accept-invite/actions";
import { PasswordInput } from "@/components/auth/password-input";
import { Button } from "@/components/ui/button";

const initialState: AcceptInviteState = { error: null };

export function AcceptInviteForm() {
  const [state, formAction, pending] = useActionState(acceptInviteAction, initialState);

  const passwordId = useId();
  const confirmId = useId();
  const formErrorId = useId();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    mode: "onTouched",
    defaultValues: { password: "", confirmPassword: "" },
  });

  const passwordError = errors.password?.message ?? state.fieldErrors?.password;
  const confirmError = errors.confirmPassword?.message ?? state.fieldErrors?.confirmPassword;

  const onSubmit = (values: ResetPasswordInput) => {
    if (pending) return;
    const data = new FormData();
    data.set("password", values.password);
    data.set("confirmPassword", values.confirmPassword);
    startTransition(() => formAction(data));
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
      {state.error && (
        <p id={formErrorId} role="alert" className="rounded-xl border border-danger/30 bg-danger-surface px-3.5 py-3 text-sm text-danger">
          {state.error}
        </p>
      )}

      <div className="space-y-1.5">
        <label htmlFor={passwordId} className="block text-sm font-medium text-text-secondary">
          Nueva contraseña
        </label>
        <PasswordInput
          {...register("password")}
          id={passwordId}
          autoComplete="new-password"
          enterKeyHint="next"
          placeholder="Mínimo 8 caracteres"
          invalid={Boolean(passwordError)}
          aria-describedby={passwordError ? `${passwordId}-error` : undefined}
        />
        {passwordError && (
          <p id={`${passwordId}-error`} className="text-xs text-danger">{passwordError}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <label htmlFor={confirmId} className="block text-sm font-medium text-text-secondary">
          Confirmar contraseña
        </label>
        <PasswordInput
          {...register("confirmPassword")}
          id={confirmId}
          autoComplete="new-password"
          enterKeyHint="go"
          placeholder="Repite la contraseña"
          invalid={Boolean(confirmError)}
          aria-describedby={confirmError ? `${confirmId}-error` : undefined}
        />
        {confirmError && (
          <p id={`${confirmId}-error`} className="text-xs text-danger">{confirmError}</p>
        )}
      </div>

      <Button type="submit" variant="primary" size="lg" loading={pending} loadingText="ACTIVANDO CUENTA…" className="w-full uppercase">
        Activar mi cuenta
      </Button>
    </form>
  );
}
