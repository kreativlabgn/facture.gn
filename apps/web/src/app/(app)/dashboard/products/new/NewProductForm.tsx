"use client";

import { useActionState, useState } from "react";
import { Button, Field, TextInput } from "@/components/ui";
import type { ProductType } from "@/lib/trust-api";
import { createProductAction, type CreateProductActionState } from "./actions";

const TYPES: { valeur: ProductType; label: string }[] = [
  { valeur: "product", label: "Produit" },
  { valeur: "service", label: "Service" },
];

const DESCRIPTION_MAX_LENGTH = 500;

// Catalogue produits/services (docs/plans/2026-09-16-catalogue-produits-services.md).
//
// Le radio "Type" n'a AUCUNE valeur par défaut cochée : le fondateur veut un
// choix explicite, jamais un type retenu par défaut sans que le marchand l'ait
// vraiment décidé (plan, clarification 1 — "seul champ structurellement requis
// en plus de name"). Même styling de radio que le règlement de
// VenteComptoirForm.tsx, seul précédent de ce dépôt pour un choix à bascule.
export function NewProductForm() {
  const [state, formAction, pending] = useActionState<CreateProductActionState, FormData>(
    createProductAction,
    null,
  );
  const [description, setDescription] = useState("");

  return (
    <form action={formAction} className="flex flex-col gap-5 rounded-2xl border border-navy-100 bg-white p-5">
      <Field label="Nom" htmlFor="produit-nom">
        <TextInput id="produit-nom" name="name" type="text" required placeholder="Sac de riz 50kg" />
      </Field>

      <fieldset>
        <legend className="mb-1.5 block font-sans text-[11px] font-semibold tracking-wide text-navy-950 uppercase">
          Type
        </legend>
        <div className="grid grid-cols-2 gap-2">
          {TYPES.map((option) => (
            <label
              key={option.valeur}
              className="flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-lg border border-navy-200 px-3 text-sm font-medium text-navy-950 has-[:checked]:border-navy-950 has-[:checked]:bg-navy-50"
            >
              <input type="radio" name="type" value={option.valeur} required className="accent-navy-950" />
              {option.label}
            </label>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-navy-600">
          Ce choix ne pourra plus être modifié une fois la fiche créée.
        </p>
      </fieldset>

      <Field label="Description — optionnel" htmlFor="produit-description">
        <textarea
          id="produit-description"
          name="description"
          rows={3}
          maxLength={DESCRIPTION_MAX_LENGTH}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Ce que ce produit ou service couvre, pour vous y retrouver plus tard"
          aria-describedby="produit-description-compteur"
          className="w-full rounded-lg border border-navy-200 bg-white px-3.5 py-2.5 text-sm text-navy-950 placeholder:text-navy-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-950"
        />
        <p id="produit-description-compteur" className="mt-1.5 text-xs text-navy-600">
          {description.length}/{DESCRIPTION_MAX_LENGTH} caractères
        </p>
      </Field>

      <Field
        label="Prix de vente (GNF) — optionnel"
        htmlFor="produit-prix"
        hint="Laissez vide pour un article sur devis, sans prix fixe."
      >
        <TextInput
          id="produit-prix"
          name="salePriceGnf"
          type="number"
          min={0}
          inputMode="numeric"
          placeholder="85000"
          aria-describedby="produit-prix-hint"
        />
      </Field>

      {state && "error" in state ? (
        <p role="status" className="text-sm text-bad-text">
          {state.error}
        </p>
      ) : null}

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Création…" : "Créer"}
        </Button>
      </div>
    </form>
  );
}
