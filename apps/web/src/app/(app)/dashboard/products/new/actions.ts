"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSessionToken } from "@/lib/session";
import { resolveActiveOrganization } from "@/lib/active-organization";
import { createProduct, TrustApiError, type ProductType } from "@/lib/trust-api";

export type CreateProductActionState = { error: string } | null;

const DESCRIPTION_MAX_LENGTH = 500;

// Catalogue produits/services (docs/plans/2026-09-16-catalogue-produits-services.md).
//
// organizationId n'est JAMAIS lu depuis le formulaire — résolu ici depuis la
// session, même discipline que createAndIssueInvoiceAction/createCustomerAction :
// ne jamais faire confiance à un champ client pour une valeur qui détermine
// l'autorisation.
export async function createProductAction(
  _prevState: CreateProductActionState,
  formData: FormData,
): Promise<CreateProductActionState> {
  const token = await requireSessionToken();
  const { active: organization } = await resolveActiveOrganization(token);
  if (!organization) {
    return { error: "Aucune organisation associée à ce compte" };
  }

  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    return { error: "Le nom est requis" };
  }

  // Seul champ structurellement requis en plus de `name` (plan, clarification
  // 1) : un formulaire qui laisserait ce choix vide produirait une fiche que
  // ProductStock ne peut pas fonder. Refusé AVANT tout appel réseau, même
  // discipline que le refus de numéro invalide dans createAndIssueInvoiceAction.
  const typeRaw = String(formData.get("type") ?? "");
  if (typeRaw !== "product" && typeRaw !== "service") {
    return { error: "Choisissez un type : produit ou service" };
  }
  // `typeRaw` est vérifié ci-dessus contre les deux seules valeurs possibles —
  // TypeScript ne réduit pas `string` en littéraux par élimination, même
  // convention de cast que `documentType` dans invoices/new/actions.ts.
  const type = typeRaw as ProductType;

  const descriptionRaw = String(formData.get("description") ?? "").trim();
  if (descriptionRaw.length > DESCRIPTION_MAX_LENGTH) {
    return { error: `La description ne peut pas dépasser ${DESCRIPTION_MAX_LENGTH} caractères` };
  }

  // Saisie en GNF (naturel pour le marchand) → centimes GNF pour l'API
  // (convention repo, voir schema.prisma) — même conversion que les lignes de
  // facture (invoices/new/actions.ts), jamais laissée au client. Vide = pas de
  // prix fixe (catégorie "sur devis", clarification 1 du plan) : la clé reste
  // absente du payload plutôt que d'envoyer 0, qui affirmerait un prix nul.
  const salePriceGnfRaw = String(formData.get("salePriceGnf") ?? "").trim();
  let salePrice: string | undefined;
  if (salePriceGnfRaw !== "") {
    const salePriceGnf = Number(salePriceGnfRaw);
    if (!Number.isFinite(salePriceGnf) || salePriceGnf < 0) {
      return { error: "Le prix de vente doit être un nombre positif" };
    }
    salePrice = String(Math.round(salePriceGnf * 100));
  }

  let created;
  try {
    created = await createProduct(token, {
      organizationId: organization.id,
      name,
      type,
      description: descriptionRaw || undefined,
      salePrice,
    });
  } catch (error) {
    if (error instanceof TrustApiError) {
      return { error: error.message };
    }
    return { error: "Création temporairement indisponible" };
  }

  revalidatePath("/dashboard/products");
  // Un seul appelant (NewProductForm) : contrairement à
  // createAndIssueInvoiceAction (partagé entre deux écrans qui redirigent
  // différemment), rien n'empêche cette action de rediriger elle-même — même
  // précédent que mergeCustomerAction pour son cas "inverted".
  redirect(`/dashboard/products/${created.id}`);
}
