"use client";

import { useActionState } from "react";
import { revokeMemberAction, type RevokeMemberActionState } from "./actions";

// Retrait d'un collaborateur du cabinet.
//
// C'est l'action qui donne son sens au mandat accordé à l'ENTITÉ (ADR-068) :
// l'accès aux clients ne passe par aucune appartenance individuelle, donc ce
// seul geste coupe TOUS les accès d'un coup, sans avoir à parcourir les mandats
// un par un.
//
// Le bouton EST le formulaire : pas de boîte de dialogue, qui exigerait du
// JavaScript. Le libellé porte donc seul l'avertissement, et le texte de
// confirmation apparaît après coup, comme partout ailleurs dans ce dépôt.
export function RevokeMemberForm({ memberUserId, nom }: { memberUserId: string; nom: string }) {
  const [state, formAction, pending] = useActionState<RevokeMemberActionState, FormData>(
    revokeMemberAction,
    null,
  );

  return (
    <div className="flex flex-col items-end gap-1.5">
      <form action={formAction}>
        <input type="hidden" name="memberUserId" value={memberUserId} />
        <button
          type="submit"
          disabled={pending}
          // Le nom dans le libellé accessible : « Retirer » seul, répété sur
          // dix lignes, ne dit pas au lecteur d'écran QUI serait retiré.
          aria-label={`Retirer ${nom} du cabinet`}
          className="min-h-[36px] rounded-lg px-3 text-sm font-medium text-bad-text transition hover:bg-bad-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-950 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {pending ? "Retrait…" : "Retirer"}
        </button>
      </form>
      {state ? (
        <p
          role="status"
          className={`max-w-xs text-right text-xs ${"error" in state ? "text-bad-text" : "text-good-text"}`}
        >
          {"error" in state ? state.error : state.ok}
        </p>
      ) : null}
    </div>
  );
}
