"use client";

import { useActionState } from "react";
import { Button, Field, TextInput } from "@/components/ui";
import { formaterMsisdn, OPERATEURS } from "@/lib/mobile-money";
import { formatGnf } from "@/lib/format";
import { initiateMobileMoneyPaymentAction, type PaiementActionState } from "./actions";

// Formulaire de règlement Mobile Money du checkout public (Chantier 3).
//
// Aucune icône de bibliothèque : les tracés <svg> sont écrits ici, comme
// partout ailleurs dans ce repo. Un pack d'icônes pour deux glyphes ajouterait
// du JS à une page que des payeurs ouvrent en 3G depuis un téléphone d'entrée
// de gamme.
export function MobileMoneyForm({
  invoiceId,
  totalAffiche,
  provider,
}: {
  invoiceId: string;
  /** Le total du récapitulatif juste au-dessus, repris mot pour mot sur le
   *  bouton : le payeur doit lire le même nombre aux deux endroits. */
  totalAffiche: string;
  provider: string;
}) {
  const [etat, soumettre, enCours] = useActionState<PaiementActionState, FormData>(
    initiateMobileMoneyPaymentAction,
    null,
  );

  if (etat?.statut === "engage") {
    return <DemandeEnvoyee etat={etat} />;
  }

  return (
    <form action={soumettre} className="mt-6 flex flex-col gap-4">
      <input type="hidden" name="invoiceId" value={invoiceId} />

      <fieldset>
        <legend className="text-sm font-semibold text-navy-950">Votre opérateur</legend>
        {/* Déclaré par le payeur, jamais déduit du préfixe : la portabilité des
            numéros existe en Guinée, et deviner enverrait la demande sur le
            mauvais réseau sans que le payeur comprenne pourquoi rien n'arrive. */}
        <div className="mt-2 grid grid-cols-2 gap-3">
          {OPERATEURS.map((operateur, index) => (
            <label
              key={operateur.valeur}
              className="flex cursor-pointer items-center gap-2 rounded-[10px] border border-navy-200 px-4 py-3 text-sm font-medium text-navy-950 has-[:checked]:border-navy-950 has-[:checked]:bg-navy-50"
            >
              <input
                type="radio"
                name="operator"
                value={operateur.valeur}
                defaultChecked={index === 0}
                className="accent-navy-950"
              />
              {operateur.label}
            </label>
          ))}
        </div>
      </fieldset>

      <Field
        label="Numéro à débiter"
        htmlFor="msisdn"
        hint="Le numéro de votre compte Mobile Money, par exemple 622 00 00 00."
      >
        <TextInput
          id="msisdn"
          name="msisdn"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="622 00 00 00"
          aria-describedby="msisdn-hint"
          required
        />
      </Field>

      {etat?.statut === "erreur" ? (
        <p
          role="alert"
          className="rounded-lg border border-bad bg-bad-bg px-3 py-2 text-sm text-bad-text"
        >
          {etat.message}
        </p>
      ) : null}

      <Button type="submit" variant="accent" size="lg" disabled={enCours}>
        {enCours ? "Envoi en cours…" : `Payer ${totalAffiche}`}
      </Button>

      <p className="text-center text-xs text-navy-600">
        Paiement traité par {provider}. Vous validerez le débit sur votre téléphone.
      </p>
    </form>
  );
}

// Le débit est `pending`, jamais acquis : l'écran dit « demande envoyée », pas
// « paiement réussi ». C'est le webhook de l'opérateur qui fera passer la
// facture à « réglée », et lui seul — annoncer un encaissement ici mentirait
// sur une transaction qu'un payeur peut encore refuser sur son clavier.
function DemandeEnvoyee({
  etat,
}: {
  etat: Extract<PaiementActionState, { statut: "engage" }>;
}) {
  return (
    <div className="mt-6 rounded-[10px] border border-navy-200 bg-navy-50 p-5 text-center">
      <svg
        viewBox="0 0 24 24"
        className="mx-auto h-8 w-8 text-navy-950"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="6" y="2" width="12" height="20" rx="2" />
        <path d="M11 18h2" />
      </svg>
      <p className="mt-3 font-display text-base font-bold text-navy-950">
        Demande envoyée au {formaterMsisdn(etat.msisdn)}
      </p>
      <p className="mt-2 text-sm text-navy-600">{etat.instruction}</p>
      <p className="mt-3 font-mono text-sm font-bold tabular-nums text-navy-950">
        {formatGnf(etat.totalDebiteGnf)}
      </p>
      <p className="mt-3 text-xs text-navy-600">
        Cette facture sera marquée réglée dès que votre opérateur confirmera le paiement.
      </p>
    </div>
  );
}
