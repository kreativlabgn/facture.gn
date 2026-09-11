"use client";

import { useActionState } from "react";
import { Button, Field, TextInput } from "@/components/ui";
import { loginAction, type LoginActionState } from "./actions";

export function LoginForm({ returnTo }: { returnTo?: string }) {
  const [state, formAction, pending] = useActionState<LoginActionState, FormData>(loginAction, null);

  return (
    <form action={formAction} className="flex flex-col gap-4 text-left">
      {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
      <Field label="Numéro de téléphone" htmlFor="msisdn">
        <TextInput
          id="msisdn"
          name="msisdn"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          placeholder="+224620000000"
        />
      </Field>
      <Field label="Mot de passe" htmlFor="password">
        <TextInput id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      {state?.error ? (
        <p role="alert" className="text-sm text-red-text">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Connexion..." : "Se connecter"}
      </Button>
    </form>
  );
}
