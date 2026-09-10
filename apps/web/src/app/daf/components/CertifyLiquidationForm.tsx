"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui";
import { validateLiquidationAction, type LiquidationActionState } from "../actions";

// J1 — VISER LE SERVICE FAIT.
//
// Le bouton EST le formulaire, sans boîte de dialogue : celle-ci exigerait du
// JavaScript pour un geste qui doit rester possible sans (même discipline que
// RevokeMemberForm). L'avertissement tient donc dans le libellé et le texte qui
// l'accompagne, et la confirmation arrive après coup.
//
// `pending` désactive le bouton le temps de l'aller-retour : un double clic est
// de toute façon sans conséquence côté trust-api (validateLiquidation() est
// idempotent — un second appel ne crée pas un second InvoiceEvent), mais un
// bouton qui reste cliquable pendant deux secondes laisse croire que le premier
// clic n'a pas pris.
export function CertifyLiquidationForm({ invoiceId, reference }: { invoiceId: string; reference: string }) {
  const [state, formAction, pending] = useActionState<LiquidationActionState, FormData>(
    validateLiquidationAction,
    null,
  );

  return (
    <div className="flex flex-col items-start gap-1.5">
      <form action={formAction}>
        <input type="hidden" name="invoiceId" value={invoiceId} />
        <Button
          type="submit"
          disabled={pending}
          variant="primary"
          // « Viser » seul, répété sur chaque ligne, ne dit pas au lecteur
          // d'écran QUELLE dépense serait visée.
          aria-label={`Viser le service fait — ${reference}`}
        >
          {pending ? "Visa en cours…" : "Viser le service fait"}
        </Button>
      </form>
      {state ? (
        <p
          role="status"
          className={`max-w-md text-xs ${"error" in state ? "text-bad-text" : "text-good-text"}`}
        >
          {"error" in state ? state.error : state.ok}
        </p>
      ) : null}
    </div>
  );
}
