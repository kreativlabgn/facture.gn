'use client';

import { FormEvent, useState } from 'react';
import { enrolFieldMerchant } from './actions';

interface FieldOnboardingInput {
  commerceName: string;
  merchantPhone: string;
  consentAttested: boolean;
}

export default function FieldOfficerPage() {
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSuccessMessage(null);
    setErrorMessage(null);

    const formData = new FormData(event.currentTarget);
    const data: FieldOnboardingInput = {
      commerceName: String(formData.get('commerceName') ?? '').trim(),
      merchantPhone: String(formData.get('merchantPhone') ?? '').trim(),
      consentAttested: formData.get('consentAttested') === 'on',
    };

    if (!data.commerceName || !/^\d{9}$/.test(data.merchantPhone)) {
      setErrorMessage('Saisissez un nom de commerce et un numéro guinéen à 9 chiffres.');
      return;
    }

    // Ce compte n'est pas ouvert par le marchand lui-même : c'est l'agent qui
    // saisit à sa place. consentAttested est donc la seule trace qu'un
    // consentement a réellement été recueilli avant l'enrôlement — sans elle,
    // trust-api enregistrerait une preuve légale de consentement (L/2016/037,
    // AssistedSession.consentRecordedAt) que personne n'a jamais donnée.
    if (!data.consentAttested) {
      setErrorMessage("Confirmez avoir recueilli le consentement du marchand avant de continuer.");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await enrolFieldMerchant(data.commerceName, data.merchantPhone, data.consentAttested);
      if ('error' in result) {
        setErrorMessage(result.error);
        return;
      }

      setSuccessMessage(`Marchand « ${data.commerceName} » enrôlé avec succès.`);
      event.currentTarget.reset();
    } catch {
      setErrorMessage('Erreur lors de la création du compte. Réessayez.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="mx-auto mt-12 max-w-md px-4 pb-12">
      <div className="rounded-lg border border-navy-100 bg-white p-6 shadow-sm">
        <div className="mb-6 space-y-2">
          <h1 className="font-display text-xl font-bold tracking-tight text-navy-950">Espace Agent Terrain</h1>
          <p className="text-sm text-navy-600">Immatriculation rapide - Secteur Informel (3AE)</p>
        </div>

        {successMessage ? (
          <div className="mb-4 rounded border border-green-200 bg-green-bg p-3 text-sm font-medium text-green-text" role="status">
            {successMessage}
          </div>
        ) : null}
        {errorMessage ? (
          <div className="mb-4 rounded border border-red-200 bg-red-bg p-3 text-sm font-medium text-red-text" role="alert">
            {errorMessage}
          </div>
        ) : null}

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="commerceName" className="block text-xs font-semibold uppercase text-navy-600">
              Nom du commerce
            </label>
            <input
              id="commerceName"
              name="commerceName"
              required
              placeholder="Ex. Établissements Camara et Fils"
              className="w-full rounded-md border border-navy-200 bg-transparent p-2 text-sm text-navy-950 focus:outline-none focus:ring-1 focus:ring-yellow"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="merchantPhone" className="block text-xs font-semibold uppercase text-navy-600">
              Téléphone du marchand (MSISDN)
            </label>
            <input
              id="merchantPhone"
              name="merchantPhone"
              required
              inputMode="numeric"
              pattern="[0-9]{9}"
              placeholder="Ex. 620112233"
              className="w-full rounded-md border border-navy-200 bg-transparent p-2 font-mono text-sm text-navy-950 focus:outline-none focus:ring-1 focus:ring-yellow"
            />
          </div>

          <div className="flex items-start gap-2 rounded-md border border-navy-200 bg-navy-50 p-3">
            <input
              id="consentAttested"
              name="consentAttested"
              type="checkbox"
              required
              className="mt-0.5 size-4 shrink-0 accent-navy-950"
            />
            <label htmlFor="consentAttested" className="text-xs leading-relaxed text-navy-800">
              Je certifie avoir lu au marchand la notice d&apos;information et recueilli son
              accord oral pour créer ce compte en son nom (L/2016/037).
            </label>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-md border border-navy-950 bg-yellow p-2.5 text-sm font-semibold text-navy-950 transition-colors hover:bg-yellow/90 disabled:opacity-50"
          >
            {isSubmitting ? 'Immatriculation en cours...' : 'Enrôler le marchand'}
          </button>
        </form>
      </div>
    </main>
  );
}
