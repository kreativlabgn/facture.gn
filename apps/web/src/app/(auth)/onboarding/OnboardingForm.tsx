"use client";

import { useActionState, useState } from "react";
import { Button, Field, SelectInput, TextInput } from "@/components/ui";
import {
  LEGAL_FORMS,
  LEGAL_FORM_LABELS,
  REGIMES_FISCAUX,
  REGIME_FISCAL_LABELS,
  allowedRegimesFor,
  isLegalForm,
  type LegalForm,
} from "@/lib/fiscal";
import { createOrganizationAction, type OnboardingActionState } from "./actions";

export function OnboardingForm() {
  const [state, formAction, pending] = useActionState<OnboardingActionState, FormData>(
    createOrganizationAction,
    null,
  );
  const fieldErrors = state?.fieldErrors ?? {};

  // La forme légale filtre les régimes proposés (I4/ADR-057). C'est une
  // AMÉLIORATION, pas la garantie : sans JavaScript, les quatre régimes sont
  // rendus et c'est validateFiscalIdentity() — puis trust-api — qui refusent
  // la combinaison interdite. Un <select> désactivé en attendant un choix
  // rendrait le formulaire insoumissible sur un téléphone sans JS.
  const [legalForm, setLegalForm] = useState<LegalForm | "">(
    isLegalForm(state?.values?.legalForm ?? "") ? (state?.values?.legalForm as LegalForm) : "",
  );
  const regimes = legalForm === "" ? REGIMES_FISCAUX : allowedRegimesFor(legalForm);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Field label="Nom de votre organisation" htmlFor="org-name">
        <TextInput
          id="org-name"
          name="name"
          type="text"
          required
          defaultValue={state?.values?.name}
          placeholder="Ex. Boutique Aissatou"
          aria-invalid={fieldErrors.name ? true : undefined}
          aria-describedby={fieldErrors.name ? "org-name-error" : undefined}
        />
        {fieldErrors.name ? <FieldError id="org-name-error">{fieldErrors.name}</FieldError> : null}
      </Field>

      <Field label="Forme légale" htmlFor="org-legal-form">
        <SelectInput
          id="org-legal-form"
          name="legalForm"
          required
          defaultValue={state?.values?.legalForm ?? ""}
          onChange={(event) => setLegalForm(isLegalForm(event.target.value) ? event.target.value : "")}
          aria-invalid={fieldErrors.legalForm ? true : undefined}
          aria-describedby={fieldErrors.legalForm ? "org-legal-form-error" : undefined}
        >
          <option value="">Choisir…</option>
          {LEGAL_FORMS.map((form) => (
            <option key={form} value={form}>
              {LEGAL_FORM_LABELS[form]}
            </option>
          ))}
        </SelectInput>
        {fieldErrors.legalForm ? <FieldError id="org-legal-form-error">{fieldErrors.legalForm}</FieldError> : null}
      </Field>

      <Field
        label="Régime fiscal"
        htmlFor="org-regime"
        hint="Aucun régime n'est présélectionné : c'est lui qui détermine la TVA de vos factures."
      >
        <SelectInput
          id="org-regime"
          name="regimeFiscal"
          required
          defaultValue={state?.values?.regimeFiscal ?? ""}
          aria-describedby={fieldErrors.regimeFiscal ? "org-regime-error org-regime-hint" : "org-regime-hint"}
          aria-invalid={fieldErrors.regimeFiscal ? true : undefined}
        >
          <option value="">Choisir…</option>
          {regimes.map((regime) => (
            <option key={regime} value={regime}>
              {REGIME_FISCAL_LABELS[regime]}
            </option>
          ))}
        </SelectInput>
        {fieldErrors.regimeFiscal ? <FieldError id="org-regime-error">{fieldErrors.regimeFiscal}</FieldError> : null}
      </Field>

      {/* <details> natif plutôt qu'un état React : le repli fonctionne sans une
          ligne de JavaScript. Les deux champs restent dans le DOM même replié —
          vides, donc absents au sens d'ADR-035, et la paire reste symétrique. */}
      <details
        open={Boolean(state?.values?.nif || state?.values?.etaxNumber || fieldErrors.nif || fieldErrors.etaxNumber)}
        className="rounded-xl border border-navy-100 bg-navy-50/40 p-4"
      >
        <summary className="cursor-pointer text-sm font-semibold text-navy-950">
          Mon entreprise est formalisée
          <span className="mt-0.5 block font-normal text-xs text-navy-600">
            NIF et numéro eTax. Facultatif — vous pourrez les ajouter plus tard sans bloquer vos factures.
          </span>
        </summary>

        <div className="mt-4 flex flex-col gap-4">
          <Field label="NIF" htmlFor="org-nif">
            <TextInput
              id="org-nif"
              name="nif"
              type="text"
              inputMode="numeric"
              defaultValue={state?.values?.nif}
              placeholder="9 chiffres"
              aria-invalid={fieldErrors.nif ? true : undefined}
              aria-describedby={fieldErrors.nif ? "org-nif-error" : undefined}
            />
            {fieldErrors.nif ? <FieldError id="org-nif-error">{fieldErrors.nif}</FieldError> : null}
          </Field>
          <Field label="Numéro eTax" htmlFor="org-etax">
            <TextInput
              id="org-etax"
              name="etaxNumber"
              type="text"
              defaultValue={state?.values?.etaxNumber}
              aria-invalid={fieldErrors.etaxNumber ? true : undefined}
              aria-describedby={fieldErrors.etaxNumber ? "org-etax-error" : undefined}
            />
            {fieldErrors.etaxNumber ? <FieldError id="org-etax-error">{fieldErrors.etaxNumber}</FieldError> : null}
          </Field>
        </div>
      </details>

      {state?.error ? (
        <p role="alert" className="text-sm font-semibold text-red-text">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending ? "Création..." : "Créer mon organisation"}
      </Button>
    </form>
  );
}

function FieldError({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className="mt-1.5 text-xs font-semibold text-red-text">
      {children}
    </p>
  );
}
