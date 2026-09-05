"use client";

import { useActionState } from "react";
import { loginAction, type LoginActionState } from "./actions";

export function LoginForm() {
  const [state, formAction, pending] = useActionState<LoginActionState, FormData>(loginAction, null);

  return (
    <form action={formAction} className="flex flex-col gap-4 text-left">
      <div>
        <label htmlFor="msisdn" className="mb-1.5 block font-display text-[10px] font-semibold tracking-wide text-navy-950 uppercase">
          Numéro de téléphone
        </label>
        <input
          id="msisdn"
          name="msisdn"
          type="tel"
          required
          placeholder="+224620000000"
          className="w-full rounded-lg border border-navy-200 bg-white px-3.5 py-2.5 text-sm text-navy-950 placeholder:text-navy-600 focus:border-2 focus:border-navy-950 focus:outline-none"
        />
      </div>
      <div>
        <label htmlFor="password" className="mb-1.5 block font-display text-[10px] font-semibold tracking-wide text-navy-950 uppercase">
          Mot de passe
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          className="w-full rounded-lg border border-navy-200 bg-white px-3.5 py-2.5 text-sm text-navy-950 focus:border-2 focus:border-navy-950 focus:outline-none"
        />
      </div>
      {state?.error ? <p className="text-sm text-red-text">{state.error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded-[10px] bg-navy-950 px-6 py-2.5 font-display text-sm font-semibold text-white transition hover:bg-navy-800 disabled:opacity-45"
      >
        {pending ? "Connexion..." : "Se connecter"}
      </button>
    </form>
  );
}
