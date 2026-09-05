"use client";

import { useActionState } from "react";
import { requestMandateAction, type RequestMandateActionState } from "./actions";

export function RequestMandateForm() {
  const [state, formAction, pending] = useActionState<RequestMandateActionState, FormData>(requestMandateAction, null);

  return (
    <form action={formAction} className="rounded-2xl border border-navy-100 bg-white p-5">
      <p className="mb-4 font-display text-sm font-semibold text-navy-950">Demander un mandat</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <input
          name="organizationId"
          type="text"
          required
          placeholder="Identifiant de l'organisation cliente"
          className="rounded-lg border border-navy-200 bg-white px-3.5 py-2.5 text-sm text-navy-950 placeholder:text-navy-400 focus:border-2 focus:border-navy-950 focus:outline-none"
        />
      </div>
      {state?.error ? <p className="mt-3 text-sm text-red-text">{state.error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="mt-4 rounded-[10px] bg-navy-950 px-6 py-2.5 font-display text-sm font-semibold text-white transition hover:bg-navy-800 disabled:opacity-45"
      >
        {pending ? "Envoi..." : "Envoyer la demande"}
      </button>
    </form>
  );
}
