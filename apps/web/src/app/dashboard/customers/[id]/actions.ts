"use server";

import { revalidatePath } from "next/cache";
import { requireSessionToken } from "@/lib/session";
import { mergeCustomer, TrustApiError } from "@/lib/trust-api";

export type MergeCustomerActionState = { error: string } | null;

// E4, ADR-038 — fusion IRRÉVERSIBLE (le doublon est réellement supprimé,
// factures réassignées) : contrairement à revokeMandateAction/
// acceptMandateRequestAction (cabinet/mandates/actions.ts, sans confirmation
// car réversibles ou immédiates par nature), cette action exige un état
// (useActionState) pour remonter une erreur lisible — le geste de
// confirmation lui-même (case à cocher) est porté par le composant client
// MergeDuplicateForm, jamais ici : cette action ne fait AUCUNE hypothèse sur
// la façon dont l'UI a obtenu le consentement, elle applique juste la fusion
// demandée.
export async function mergeCustomerAction(
  _prevState: MergeCustomerActionState,
  formData: FormData,
): Promise<MergeCustomerActionState> {
  const token = await requireSessionToken();
  const canonicalCustomerId = String(formData.get("canonicalCustomerId") ?? "").trim();
  const duplicateCustomerId = String(formData.get("duplicateCustomerId") ?? "").trim();
  const confirmed = formData.get("confirmed") === "on";

  if (!canonicalCustomerId || !duplicateCustomerId) {
    return { error: "Fusion impossible : identifiant de client manquant" };
  }
  // Défense en profondeur — le bouton du formulaire est déjà désactivé tant
  // que la case n'est pas cochée côté client, revérifié ici car un POST peut
  // toujours être rejoué sans passer par le JS du navigateur.
  if (!confirmed) {
    return { error: "Vous devez confirmer la fusion avant de continuer" };
  }

  try {
    await mergeCustomer(token, canonicalCustomerId, duplicateCustomerId);
  } catch (error) {
    if (error instanceof TrustApiError) {
      return { error: error.message };
    }
    return { error: "Fusion temporairement indisponible" };
  }

  revalidatePath(`/dashboard/customers/${canonicalCustomerId}`);
  revalidatePath("/dashboard/customers");
  return null;
}
