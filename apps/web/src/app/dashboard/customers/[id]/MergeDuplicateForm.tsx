"use client";

import { useActionState, useState } from "react";
import { mergeCustomerAction, type MergeCustomerActionState } from "./actions";

// E4, ADR-038 — la fusion supprime réellement le client en doublon
// (irréversible). Aucun précédent de confirmation dans ce repo (le seul
// exemple d'action destructive, "Révoquer un mandat" dans
// cabinet/mandates/page.tsx, est un bouton immédiat sans confirmation —
// mais une révocation de mandat est reproductible, une suppression de
// client ne l'est pas). Choix : case à cocher explicite "je confirme" qui
// contrôle l'activation du bouton, plus une revérification côté serveur
// (mergeCustomerAction) pour ne jamais dépendre uniquement du JS client.
export function MergeDuplicateForm({
  canonicalCustomerId,
  canonicalCustomerName,
  duplicateCustomerId,
  duplicateCustomerName,
}: {
  canonicalCustomerId: string;
  canonicalCustomerName: string;
  duplicateCustomerId: string;
  duplicateCustomerName: string;
}) {
  const [state, formAction, pending] = useActionState<MergeCustomerActionState, FormData>(
    mergeCustomerAction,
    null,
  );
  const [confirmed, setConfirmed] = useState(false);

  return (
    <form action={formAction} className="rounded-2xl border border-amber-text/30 bg-amber-bg/40 p-5">
      <input type="hidden" name="canonicalCustomerId" value={canonicalCustomerId} />
      <input type="hidden" name="duplicateCustomerId" value={duplicateCustomerId} />

      <p className="font-display text-sm font-semibold text-navy-950">Doublon possible détecté</p>
      <p className="mt-2 text-sm text-navy-600">
        <span className="font-semibold text-navy-950">{duplicateCustomerName}</span> a été signalé comme doublon
        possible de ce client à sa création. Fusionner rattachera toutes ses factures à{" "}
        <span className="font-semibold text-navy-950">{canonicalCustomerName}</span> puis{" "}
        <span className="font-semibold text-red-text">supprimera définitivement</span> la fiche{" "}
        {duplicateCustomerName}.
      </p>

      <label className="mt-4 flex items-start gap-2 text-sm text-navy-950">
        <input
          type="checkbox"
          name="confirmed"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-navy-400"
        />
        <span>
          Je confirme vouloir fusionner et supprimer définitivement <strong>{duplicateCustomerName}</strong>{" "}
          (action irréversible).
        </span>
      </label>

      {state?.error ? <p className="mt-3 text-sm text-red-text">{state.error}</p> : null}

      <button
        type="submit"
        disabled={pending || !confirmed}
        className="mt-4 rounded-[10px] bg-red-text px-6 py-2.5 font-display text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-45"
      >
        {pending ? "Fusion..." : "Fusionner (irréversible)"}
      </button>
    </form>
  );
}
