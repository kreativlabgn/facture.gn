"use client";

import { useActionState } from "react";
import { Button, Field, TextInput } from "@/components/ui";
import { requestMandateAction, type RequestMandateActionState } from "./actions";

// Un seul <form>, deux boutons de soumission. Le navigateur n'envoie que le
// `name`/`value` du bouton cliqué : l'étape en cours est donc portée par le
// HTML lui-même, sans état client. Sans JavaScript, chaque clic recharge la
// page avec le résultat dans l'état de l'action — le parcours complet reste
// praticable sur un téléphone dont les scripts n'ont pas chargé.
export function RequestMandateForm() {
  const [state, formAction, pending] = useActionState<RequestMandateActionState, FormData>(requestMandateAction, null);
  const organization = state?.organization;

  return (
    <form action={formAction} className="rounded-2xl border border-navy-100 bg-white p-5">
      <p className="mb-1 font-display text-sm font-semibold text-navy-950">Demander un mandat</p>
      <p className="mb-4 text-xs text-navy-600">
        Saisissez le NIF de votre client, puis vérifiez-le : le nom de l&apos;entreprise s&apos;affichera avant
        l&apos;envoi.
      </p>

      {state?.requestedFor ? (
        <p role="status" className="mb-4 rounded-lg bg-green-bg px-3.5 py-2.5 text-sm font-semibold text-green-text">
          Demande de mandat envoyée à {state.requestedFor}.
        </p>
      ) : null}

      <Field label="NIF de l'organisation cliente" htmlFor="mandate-nif">
        <TextInput
          id="mandate-nif"
          name="nif"
          type="text"
          inputMode="numeric"
          required
          defaultValue={state?.nif}
          placeholder="9 chiffres"
          aria-invalid={state?.error ? true : undefined}
          aria-describedby={state?.error ? "mandate-error" : undefined}
        />
      </Field>

      {organization ? (
        <>
          {/* Champs cachés plutôt qu'un état client : ils survivent au
              rechargement d'une page sans JavaScript. L'identifiant reste
              revérifié côté trust-api — voir le commentaire dans actions.ts. */}
          <input type="hidden" name="organizationId" value={organization.id} />
          <input type="hidden" name="organizationName" value={organization.name} />

          {/* role="status" : sans annonce, un lecteur d'écran ne saurait pas
              que le NIF vient d'être résolu. C'est pourtant LE moment où le
              comptable vérifie qu'il ne se trompe pas de client. */}
          <p role="status" className="mt-4 rounded-lg border border-navy-100 bg-navy-50/60 px-3.5 py-3 text-sm">
            <span className="block text-xs text-navy-600">NIF {state?.nif} — organisation trouvée</span>
            <span className="font-display font-semibold text-navy-950">{organization.name}</span>
          </p>
        </>
      ) : null}

      {state?.error ? (
        <p id="mandate-error" role="alert" className="mt-3 text-sm font-semibold text-red-text">
          {state.error}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {organization ? (
          <>
            <Button type="submit" name="intent" value="request" disabled={pending}>
              {pending ? "Envoi..." : "Envoyer la demande"}
            </Button>
            {/* Se tromper de client est l'erreur coûteuse ici : on garde un
                chemin explicite pour repartir sur un autre NIF. */}
            <Button type="submit" name="intent" value="verify" variant="secondary" disabled={pending}>
              Vérifier un autre NIF
            </Button>
          </>
        ) : (
          <Button type="submit" name="intent" value="verify" disabled={pending}>
            {pending ? "Vérification..." : "Vérifier le NIF"}
          </Button>
        )}
      </div>
    </form>
  );
}
