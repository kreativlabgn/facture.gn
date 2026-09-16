"use client";

import { useActionState, useState } from "react";
import { Button, DataField, Field, TextInput } from "@/components/ui";
import { formatGnf } from "@/lib/format";
import type { ProductDetail } from "@/lib/trust-api";
import { PRODUCT_TYPE_LABELS } from "../ProductBadges";
import { updateProductAction, type UpdateProductActionState } from "./actions";

const DESCRIPTION_MAX_LENGTH = 500;

// Centimes GNF (string) → GNF entiers pour préremplir le champ de saisie —
// inverse de la conversion faite côté Server Action à l'envoi. Toujours un
// multiple de 100 en pratique (seule cette action écrit salePrice), la
// division entière ne perd donc jamais de précision réelle.
function gnfDepuisCentimes(centimes: string | null): string {
  if (centimes === null) {
    return "";
  }
  return (BigInt(centimes) / BigInt(100)).toString();
}

// Catalogue produits/services (docs/plans/2026-09-16-catalogue-produits-services.md
// §3). `type` est affiché en LECTURE SEULE : PATCH /products/:id ne l'accepte
// jamais (immuable après création), donc aucun contrôle d'édition n'existe
// pour ce champ dans cet écran — ni select, ni radio, ni valeur cachée
// modifiable. `costPrice` reste géré exclusivement par
// POST /products/:id/cost-price (E6/ADR-084) : affiché en lecture seule ici,
// jamais mélangé au formulaire d'édition qui, lui, appelle PATCH.
export function EditProductForm({ product }: { product: ProductDetail }) {
  const [state, formAction, pending] = useActionState<UpdateProductActionState, FormData>(
    updateProductAction,
    null,
  );
  const [description, setDescription] = useState(product.description ?? "");

  return (
    <form action={formAction} className="flex flex-col gap-5 rounded-2xl border border-navy-100 bg-white p-5">
      <input type="hidden" name="productId" value={product.id} />

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <DataField label="Type">
          <span>{PRODUCT_TYPE_LABELS[product.type] ?? product.type}</span>
        </DataField>
        <DataField label="Coût d'achat">
          {product.costPrice ? (
            <span className="font-mono">{formatGnf(product.costPrice)}</span>
          ) : (
            <span className="text-navy-600">—</span>
          )}
        </DataField>
      </div>
      <p className="-mt-3 text-xs text-navy-600">
        Le type ne peut pas être modifié après la création d&apos;une fiche. Le coût d&apos;achat se
        renseigne depuis son propre écran, distinct de ce formulaire.
      </p>

      <Field label="Nom" htmlFor="produit-nom">
        <TextInput id="produit-nom" name="name" type="text" required defaultValue={product.name} />
      </Field>

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
          defaultValue={gnfDepuisCentimes(product.salePrice)}
          placeholder="85000"
          aria-describedby="produit-prix-hint"
        />
      </Field>

      <label className="flex items-start gap-2.5 text-sm text-navy-950">
        <input
          type="checkbox"
          name="isActive"
          defaultChecked={product.isActive}
          className="mt-0.5 h-4 w-4 shrink-0 accent-navy-950"
        />
        <span>
          Produit actif. Le désactiver le retire du catalogue proposé sans rien effacer :
          l&apos;historique de facturation déjà émis n&apos;est jamais affecté, et la fiche reste
          modifiable à tout moment.
        </span>
      </label>

      {state ? (
        <p role="status" className={`text-sm ${"error" in state ? "text-bad-text" : "text-good-text"}`}>
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
