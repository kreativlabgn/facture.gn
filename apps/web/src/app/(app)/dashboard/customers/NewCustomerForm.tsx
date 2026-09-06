"use client";

import { useActionState } from "react";
import { createCustomerAction, type CreateCustomerActionState } from "./actions";

export function NewCustomerForm() {
  const [state, formAction, pending] = useActionState<CreateCustomerActionState, FormData>(
    createCustomerAction,
    null,
  );

  return (
    <form action={formAction} className="rounded-2xl border border-navy-100 bg-white p-5">
      <p className="mb-4 font-display text-sm font-semibold text-navy-950">Nouveau client</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <input
          name="name"
          type="text"
          required
          placeholder="Nom du client"
          className="rounded-lg border border-navy-200 bg-white px-3.5 py-2.5 text-sm text-navy-950 placeholder:text-navy-600 focus:border-2 focus:border-navy-950 focus:outline-none"
        />
        <input
          name="phone"
          type="tel"
          placeholder="+224620000000 (optionnel)"
          className="rounded-lg border border-navy-200 bg-white px-3.5 py-2.5 text-sm text-navy-950 placeholder:text-navy-600 focus:border-2 focus:border-navy-950 focus:outline-none"
        />
        <input
          name="nif"
          type="text"
          placeholder="NIF (optionnel)"
          className="rounded-lg border border-navy-200 bg-white px-3.5 py-2.5 text-sm text-navy-950 placeholder:text-navy-600 focus:border-2 focus:border-navy-950 focus:outline-none"
        />
        <select
          name="notificationChannel"
          defaultValue="sms"
          aria-label="Canal d'envoi du lien de paiement"
          className="rounded-lg border border-navy-200 bg-white px-3.5 py-2.5 text-sm text-navy-950 focus:border-2 focus:border-navy-950 focus:outline-none"
        >
          <option value="sms">Recevoir par SMS</option>
          <option value="whatsapp">Recevoir par WhatsApp</option>
          <option value="both">Recevoir par SMS et WhatsApp</option>
        </select>
      </div>
      {state?.error ? <p className="mt-3 text-sm text-red-text">{state.error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="mt-4 rounded-[10px] bg-navy-950 px-6 py-2.5 font-display text-sm font-semibold text-white transition hover:bg-navy-800 disabled:opacity-45"
      >
        {pending ? "Ajout..." : "Ajouter"}
      </button>
    </form>
  );
}
