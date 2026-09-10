"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button, Field, TextInput } from "@/components/ui";
import { loginAction, type LoginActionState } from "./actions";

export function LoginForm() {
  const [state, formAction, pending] = useActionState<LoginActionState, FormData>(loginAction, null);

  return (
    <form action={formAction} className="flex flex-col gap-4 text-left">
      <Field label="Numéro de téléphone" htmlFor="msisdn">
        <TextInput id="msisdn" name="msisdn" type="tel" required placeholder="+224620000000" />
      </Field>
      <Field label="Mot de passe" htmlFor="password">
        <TextInput id="password" name="password" type="password" required />
      </Field>
      {state?.error ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-red-text">{state.error}</p>
          {/* Le lien n'apparaît QUE sur un échec dû à un identifiant de
              démonstration. Partout ailleurs, proposer une sortie vers une
              vitrine détournerait quelqu'un de sa vraie connexion — au moment
              précis où il a besoin de réessayer, pas de visiter. */}
          {state.demo ? (
            <Link
              href={state.demo.href}
              className="text-sm font-semibold text-navy-950 underline underline-offset-2"
            >
              Ouvrir {state.demo.libelle} — sans compte
            </Link>
          ) : null}
        </div>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Connexion..." : "Se connecter"}
      </Button>
    </form>
  );
}
