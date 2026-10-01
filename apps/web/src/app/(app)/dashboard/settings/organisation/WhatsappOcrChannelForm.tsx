"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui";
import type { OrganizationDetail } from "@/lib/trust-api";
import { setWhatsappOcrChannelAction, type WhatsappOcrActionState } from "./actions";

// Bascule du canal WhatsApp de saisie OCR (plan 2026-09-16, OCR multicanal
// vocal/WhatsApp, clarification 7). Composant frère de OrganizationForm plutôt
// qu'une section directement dans page.tsx : c'est un formulaire distinct, qui
// appelle sa propre Server Action et porte son propre état pending/erreur —
// exactement la même séparation que EditProductForm vs sa page.
//
// Aucun numéro WhatsApp n'est affiché ici : rien n'est encore provisionné côté
// opérateur, l'annoncer maintenant créerait une attente que le produit ne tient
// pas encore. Le texte renvoie à une communication ultérieure.
export function WhatsappOcrChannelForm({ organization }: { organization: OrganizationDetail }) {
  const [state, formAction, pending] = useActionState<WhatsappOcrActionState, FormData>(
    setWhatsappOcrChannelAction,
    null,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex items-start gap-2.5 text-sm text-navy-950">
        <input
          type="checkbox"
          name="whatsappOcrEnabled"
          defaultChecked={organization.whatsappOcrEnabled}
          className="mt-0.5 h-4 w-4 shrink-0 accent-navy-950"
        />
        <span>Activer le canal WhatsApp</span>
      </label>

      <p className="rounded-lg bg-amber-bg px-3 py-2 text-xs text-amber-text">
        Réservé à vous et vos employés autorisés — jamais vos clients.
      </p>

      {state ? (
        <p
          role="status"
          className={
            "error" in state
              ? "rounded-lg border border-bad bg-bad-bg px-3 py-2 text-sm text-bad-text"
              : "rounded-lg border border-good bg-good-bg px-3 py-2 text-sm text-good-text"
          }
        >
          {"error" in state ? state.error : state.ok}
        </p>
      ) : null}

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Enregistrement…" : "Enregistrer"}
        </Button>
      </div>
    </form>
  );
}
