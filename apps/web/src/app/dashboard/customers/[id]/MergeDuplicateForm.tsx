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
//
// Fix minor-followups 2026-08-24 — le sens de la fusion (quelle fiche
// survit) était jusqu'ici imposé : la fiche affichée (:id de l'URL)
// devenait toujours le canonique, celle pointée par possibleDuplicateOf
// était toujours supprimée. Or la fiche à conserver n'est pas
// nécessairement celle qu'on est en train de consulter (souvent le
// doublon a plus d'historique/de données à jour). Option retenue : une
// case à cocher "inverser le sens" plutôt qu'un lien vers la page détail
// du candidat — un lien ne suffirait pas ici, puisque possibleDuplicateOf
// n'est renseigné QUE sur la fiche affichée (relation non symétrique en
// base) : la page détail du candidat n'afficherait donc aucun formulaire
// de fusion. La case à cocher reste locale à ce composant déjà existant
// (props pageCustomerId/candidateCustomerId inchangées, jamais
// renommées "canonical/duplicate" pour ne plus présupposer le sens), le
// calcul canonical/duplicate définitif est fait côté serveur
// (mergeCustomerAction) à partir du flag "inverted".
export function MergeDuplicateForm({
  pageCustomerId,
  pageCustomerName,
  candidateCustomerId,
  candidateCustomerName,
}: {
  pageCustomerId: string;
  pageCustomerName: string;
  candidateCustomerId: string;
  candidateCustomerName: string;
}) {
  const [state, formAction, pending] = useActionState<MergeCustomerActionState, FormData>(
    mergeCustomerAction,
    null,
  );
  const [confirmed, setConfirmed] = useState(false);
  const [inverted, setInverted] = useState(false);

  const survivorName = inverted ? candidateCustomerName : pageCustomerName;
  const deletedName = inverted ? pageCustomerName : candidateCustomerName;

  return (
    <form action={formAction} className="rounded-2xl border border-amber-text/30 bg-amber-bg/40 p-5">
      <input type="hidden" name="pageCustomerId" value={pageCustomerId} />
      <input type="hidden" name="candidateCustomerId" value={candidateCustomerId} />
      <input type="hidden" name="inverted" value={inverted ? "on" : "off"} />

      <p className="font-display text-sm font-semibold text-navy-950">Doublon possible détecté</p>
      <p className="mt-2 text-sm text-navy-600">
        <span className="font-semibold text-navy-950">{candidateCustomerName}</span> a été signalé comme doublon
        possible de ce client à sa création. Fusionner rattachera toutes les factures de{" "}
        <span className="font-semibold text-navy-950">{deletedName}</span> à{" "}
        <span className="font-semibold text-navy-950">{survivorName}</span> puis{" "}
        <span className="font-semibold text-red-text">supprimera définitivement</span> la fiche{" "}
        {deletedName}.
      </p>

      <label className="mt-4 flex items-start gap-2 text-sm text-navy-950">
        <input
          type="checkbox"
          checked={inverted}
          onChange={(event) => setInverted(event.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-navy-400"
        />
        <span>
          Inverser le sens : conserver <strong>{candidateCustomerName}</strong> et supprimer{" "}
          <strong>{pageCustomerName}</strong> à la place.
        </span>
      </label>

      <label className="mt-3 flex items-start gap-2 text-sm text-navy-950">
        <input
          type="checkbox"
          name="confirmed"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-navy-400"
        />
        <span>
          Je confirme vouloir fusionner et supprimer définitivement <strong>{deletedName}</strong>{" "}
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
