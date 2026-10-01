"use server";

import { revalidatePath } from "next/cache";
import { requireSessionToken } from "@/lib/session";
import { TrustApiError, updateProduct } from "@/lib/trust-api";

export type UpdateProductActionState = { error: string } | { ok: string } | null;

const DESCRIPTION_MAX_LENGTH = 500;

// Catalogue produits/services (docs/plans/2026-09-16-catalogue-produits-services.md
// §3). `type` est immuable après création : PATCH /products/:id ne l'accepte
// de toute façon jamais côté trust-api (update-product.dto.ts), et cette
// action ne lit même pas la clé "type" du formData — il n'existe donc aucun
// chemin, présent ou futur dans ce fichier, qui puisse la transmettre.
//
// Les champs éditables sont toujours envoyés, jamais omis : ce formulaire
// n'affiche que l'état COMPLET de la fiche (voir EditProductForm), il n'y a
// donc rien à "ne pas toucher" — même discipline que updateOrganizationAction
// pour nif/etaxNumber/rccm. Une chaîne vidée efface le champ (`null`, distinct
// de `undefined`) plutôt que d'être ignorée : sans ça, une description ou un
// prix de vente saisi par erreur resterait ineffaçable.
export async function updateProductAction(
  _prevState: UpdateProductActionState,
  formData: FormData,
): Promise<UpdateProductActionState> {
  const productId = String(formData.get("productId") ?? "").trim();
  if (!productId) {
    return { error: "Action impossible : identifiant de produit manquant" };
  }

  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    return { error: "Le nom est requis" };
  }

  const descriptionRaw = String(formData.get("description") ?? "").trim();
  if (descriptionRaw.length > DESCRIPTION_MAX_LENGTH) {
    return { error: `La description ne peut pas dépasser ${DESCRIPTION_MAX_LENGTH} caractères` };
  }

  // Même conversion GNF → centimes qu'à la création (products/new/actions.ts).
  // Vide = effacement explicite (`null`) : le produit redevient "sur devis",
  // jamais un simple "champ ignoré".
  const salePriceGnfRaw = String(formData.get("salePriceGnf") ?? "").trim();
  let salePrice: string | null = null;
  if (salePriceGnfRaw !== "") {
    const salePriceGnf = Number(salePriceGnfRaw);
    if (!Number.isFinite(salePriceGnf) || salePriceGnf < 0) {
      return { error: "Le prix de vente doit être un nombre positif" };
    }
    salePrice = String(Math.round(salePriceGnf * 100));
  }

  // Une case à cocher absente du FormData (décochée) doit se lire comme
  // `false`, jamais comme "ne pas toucher" — ce formulaire porte toujours
  // l'état complet de la case, désactiver un produit est un geste explicite.
  const isActive = formData.get("isActive") === "on";

  const token = await requireSessionToken();
  try {
    await updateProduct(token, productId, {
      name,
      description: descriptionRaw === "" ? null : descriptionRaw,
      salePrice,
      isActive,
    });
  } catch (error) {
    if (error instanceof TrustApiError) {
      return { error: error.message };
    }
    return { error: "Modification temporairement indisponible" };
  }

  revalidatePath(`/dashboard/products/${productId}`);
  revalidatePath("/dashboard/products");
  return { ok: "Produit mis à jour." };
}
