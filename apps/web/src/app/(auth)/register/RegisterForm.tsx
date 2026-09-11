"use client";

import { useActionState } from "react";
import { Button, Field, TextInput } from "@/components/ui";
import { PASSWORD_MIN_LENGTH } from "@/lib/registration";
import { registerAction, type RegisterActionState } from "./actions";

export function RegisterForm({ returnTo }: { returnTo?: string }) {
  const [state, formAction, pending] = useActionState<RegisterActionState, FormData>(registerAction, null);
  const fieldErrors = state?.fieldErrors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
      <Field label="Votre nom" htmlFor="register-name">
        <TextInput
          id="register-name"
          name="name"
          type="text"
          autoComplete="name"
          required
          defaultValue={state?.values?.name}
          placeholder="Ex. Aissatou Barry"
          aria-invalid={fieldErrors.name ? true : undefined}
          aria-describedby={fieldErrors.name ? "register-name-error" : undefined}
        />
        {fieldErrors.name ? <FieldError id="register-name-error">{fieldErrors.name}</FieldError> : null}
      </Field>

      <Field label="Téléphone" htmlFor="register-msisdn" hint="Numéro guinéen : +224 suivi de 8 ou 9 chiffres.">
        <TextInput
          id="register-msisdn"
          name="msisdn"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          defaultValue={state?.values?.msisdn}
          placeholder="+224 620 00 00 01"
          aria-describedby={
            fieldErrors.msisdn ? "register-msisdn-error register-msisdn-hint" : "register-msisdn-hint"
          }
          aria-invalid={fieldErrors.msisdn ? true : undefined}
        />
        {fieldErrors.msisdn ? <FieldError id="register-msisdn-error">{fieldErrors.msisdn}</FieldError> : null}
      </Field>

      <Field
        label="Mot de passe"
        htmlFor="register-password"
        hint={`${PASSWORD_MIN_LENGTH} caractères au minimum.`}
      >
        <TextInput
          id="register-password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          aria-describedby={
            fieldErrors.password ? "register-password-error register-password-hint" : "register-password-hint"
          }
          aria-invalid={fieldErrors.password ? true : undefined}
        />
        {fieldErrors.password ? <FieldError id="register-password-error">{fieldErrors.password}</FieldError> : null}
      </Field>

      {/* role="alert" : l'erreur arrive APRÈS la soumission, un lecteur d'écran
          ne la verrait pas sans annonce explicite. */}
      {state?.error ? (
        <p role="alert" className="text-sm font-semibold text-red-text">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending ? "Création..." : "Créer mon compte"}
      </Button>
    </form>
  );
}

function FieldError({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className="mt-1.5 text-xs font-semibold text-red-text">
      {children}
    </p>
  );
}
