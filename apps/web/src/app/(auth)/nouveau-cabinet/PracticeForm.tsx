"use client";

import { useActionState, useState } from "react";
import { Button, Field, SelectInput, TextInput } from "@/components/ui";
import {
  PRACTICE_REGISTRATION_LABELS,
  PRACTICE_TYPES,
  PRACTICE_TYPE_LABELS,
  isPracticeType,
  type PracticeType,
} from "@/lib/practice";
import { createPracticeAction, type NouveauCabinetState } from "./actions";

export function PracticeForm() {
  const [state, formAction, pending] = useActionState<NouveauCabinetState, FormData>(
    createPracticeAction,
    null,
  );
  const fieldErrors = state?.fieldErrors ?? {};

  // Le libellé du numéro suit le type choisi : un cabinet comptable est inscrit
  // à un Ordre, un CGA est agréé, un gestionnaire simplement enregistré. C'est
  // une AMÉLIORATION, pas une contrainte — sans JavaScript le champ garde son
  // libellé neutre et reste soumissible, il est facultatif de toute façon.
  const [type, setType] = useState<PracticeType | "">(
    isPracticeType(state?.values?.type ?? "") ? (state?.values?.type as PracticeType) : "",
  );
  const libelleNumero =
    type === "" ? "Numéro d'enregistrement" : PRACTICE_REGISTRATION_LABELS[type];

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Field label="Nom du cabinet" htmlFor="pratique-nom">
        <TextInput
          id="pratique-nom"
          name="name"
          type="text"
          required
          defaultValue={state?.values?.name}
          placeholder="Ex. Cabinet Barry & Associés"
          aria-invalid={fieldErrors.name ? true : undefined}
          aria-describedby={fieldErrors.name ? "pratique-nom-error" : undefined}
        />
        {fieldErrors.name ? <ErreurChamp id="pratique-nom-error">{fieldErrors.name}</ErreurChamp> : null}
      </Field>

      <Field label="Type de structure" htmlFor="pratique-type">
        <SelectInput
          id="pratique-type"
          name="type"
          required
          defaultValue={state?.values?.type ?? ""}
          onChange={(event) => setType(isPracticeType(event.target.value) ? event.target.value : "")}
          aria-invalid={fieldErrors.type ? true : undefined}
          aria-describedby={fieldErrors.type ? "pratique-type-error" : undefined}
        >
          <option value="">Choisir…</option>
          {PRACTICE_TYPES.map((valeur) => (
            <option key={valeur} value={valeur}>
              {PRACTICE_TYPE_LABELS[valeur]}
            </option>
          ))}
        </SelectInput>
        {fieldErrors.type ? <ErreurChamp id="pratique-type-error">{fieldErrors.type}</ErreurChamp> : null}
      </Field>

      <Field label="Téléphone du cabinet" htmlFor="pratique-phone">
        <TextInput
          id="pratique-phone"
          name="phone"
          type="tel"
          inputMode="tel"
          required
          defaultValue={state?.values?.phone}
          placeholder="+224620000000"
          aria-invalid={fieldErrors.phone ? true : undefined}
          aria-describedby={fieldErrors.phone ? "pratique-phone-error" : undefined}
        />
        {fieldErrors.phone ? (
          <ErreurChamp id="pratique-phone-error">{fieldErrors.phone}</ErreurChamp>
        ) : null}
      </Field>

      <Field label={`${libelleNumero} (facultatif)`} htmlFor="pratique-registration">
        <TextInput
          id="pratique-registration"
          name="registrationNumber"
          type="text"
          defaultValue={state?.values?.registrationNumber}
        />
      </Field>

      <Field label="E-mail du cabinet (facultatif)" htmlFor="pratique-email">
        <TextInput
          id="pratique-email"
          name="email"
          type="email"
          defaultValue={state?.values?.email}
          placeholder="contact@cabinet.gn"
          aria-invalid={fieldErrors.email ? true : undefined}
          aria-describedby={fieldErrors.email ? "pratique-email-error" : undefined}
        />
        {fieldErrors.email ? (
          <ErreurChamp id="pratique-email-error">{fieldErrors.email}</ErreurChamp>
        ) : null}
      </Field>

      {/* Erreur globale : celle que rend trust-api, ou le rappel qu'un champ
          est signalé plus haut. role="alert" pour qu'elle soit annoncée. */}
      {state?.error ? (
        <p role="alert" className="rounded-lg border border-bad bg-bad-bg px-3 py-2 text-sm text-bad-text">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Création…" : "Créer le cabinet"}
      </Button>

      <p className="text-xs text-navy-600">
        Vous en devenez l&apos;administrateur. Vous pourrez ensuite inviter vos collaborateurs et
        demander des mandats à vos clients.
      </p>
    </form>
  );
}

function ErreurChamp({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className="mt-1 text-xs text-bad-text">
      {children}
    </p>
  );
}
