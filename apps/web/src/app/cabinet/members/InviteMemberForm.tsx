"use client";

import { useActionState } from "react";
import { inviteMemberAction, type InviteMemberActionState } from "./actions";

export function InviteMemberForm() {
  const [state, formAction, pending] = useActionState<InviteMemberActionState, FormData>(inviteMemberAction, null);

  return (
    <form action={formAction} className="rounded-2xl border border-navy-100 bg-white p-5">
      <p className="mb-4 font-display text-sm font-semibold text-navy-950">Inviter un collaborateur</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <input
          name="msisdn"
          type="tel"
          required
          placeholder="+224620000000"
          className="rounded-lg border border-[#D1D5DB] bg-white px-3.5 py-2.5 text-sm text-navy-950 placeholder:text-navy-400 focus:border-2 focus:border-navy-950 focus:outline-none"
        />
      </div>
      {/* Rôle fixé côté serveur à accountant_external — seul choix MVP (ADR-070),
          aucun sélecteur : pas d'option qui échouerait silencieusement. */}
      <p className="mt-2 text-xs text-navy-400">Rôle : comptable externe (seul rôle disponible pour l&apos;instant)</p>
      {state?.error ? <p className="mt-3 text-sm text-red-text">{state.error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="mt-4 rounded-[10px] bg-navy-950 px-6 py-2.5 font-display text-sm font-semibold text-white transition hover:bg-navy-800 disabled:opacity-45"
      >
        {pending ? "Invitation..." : "Inviter"}
      </button>
    </form>
  );
}
