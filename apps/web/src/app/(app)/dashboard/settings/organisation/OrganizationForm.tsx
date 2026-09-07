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
import type { OrganizationDetail } from "@/lib/trust-api";
import { updateOrganizationAction, type FicheActionState } from "./actions";

// Fiche d'identité légale, modifiable.
//
// Le filtrage des régimes par forme légale (I4/ADR-057) est une AMÉLIORATION,
// pas la garantie : sans JavaScript les quatre régimes restent rendus, et c'est
// trust-api qui refuse la combinaison interdite — avec un 409 explicite. Même
// discipline que l'onboarding, dont ce formulaire est le pendant en édition.
export function OrganizationForm({ organization }: { organization: OrganizationDetail }) {
  const [state, formAction, pending] = useActionState<FicheActionState, FormData>(
    updateOrganizationAction,
    null,
  );

  const [legalForm, setLegalForm] = useState<LegalForm | "">(
    isLegalForm(organization.legalForm) ? organization.legalForm : "",
  );
  const regimes = legalForm === "" ? REGIMES_FISCAUX : allowedRegimesFor(legalForm);

  const verifiee = organization.dgiVerificationStatus === "verified";

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <Field label="Nom de l'organisation" htmlFor="fiche-nom">
        <TextInput id="fiche-nom" name="name" type="text" required defaultValue={organization.name} />
      </Field>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label="Forme légale" htmlFor="fiche-forme">
          <SelectInput
            id="fiche-forme"
            name="legalForm"
            required
            defaultValue={organization.legalForm}
            onChange={(event) => setLegalForm(isLegalForm(event.target.value) ? event.target.value : "")}
          >
            {LEGAL_FORMS.map((forme) => (
              <option key={forme} value={forme}>
                {LEGAL_FORM_LABELS[forme]}
              </option>
            ))}
          </SelectInput>
        </Field>

        <Field label="Régime fiscal" htmlFor="fiche-regime">
          <SelectInput id="fiche-regime" name="regimeFiscal" required defaultValue={organization.regimeFiscal}>
            {regimes.map((regime) => (
              <option key={regime} value={regime}>
                {REGIME_FISCAL_LABELS[regime]}
              </option>
            ))}
          </SelectInput>
        </Field>
      </div>

      <p className="text-xs leading-relaxed text-navy-600">
        Changer de régime fiscal n&apos;affecte que les factures à venir. Celles déjà émises
        conservent le taux de TVA appliqué au moment de leur émission.
      </p>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label="NIF" htmlFor="fiche-nif">
          <TextInput id="fiche-nif" name="nif" type="text" defaultValue={organization.nif ?? ""} />
        </Field>

        <Field label="Numéro eTax" htmlFor="fiche-etax">
          <TextInput
            id="fiche-etax"
            name="etaxNumber"
            type="text"
            defaultValue={organization.etaxNumber ?? ""}
          />
        </Field>
      </div>

      <p className="text-xs leading-relaxed text-navy-600">
        NIF et numéro eTax vont par paire : renseignez les deux, ou aucun des deux.
        {verifiee ? (
          <>
            {" "}
            <strong className="text-amber-text">
              Votre organisation est vérifiée par la DGI. Modifier l&apos;un de ces deux numéros
              annulera cette vérification
            </strong>{" "}
            — l&apos;administration n&apos;a validé que les numéros actuels.
          </>
        ) : null}
      </p>

      <Field label="RCCM (facultatif)" htmlFor="fiche-rccm">
        <TextInput id="fiche-rccm" name="rccm" type="text" defaultValue={organization.rccm ?? ""} />
      </Field>

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
