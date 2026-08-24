"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
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
//
// Fix minor-followups 2026-08-24 — le formulaire n'envoie plus canonical/
// duplicate directement (la fiche affichée n'est pas forcément celle à
// conserver) mais pageCustomerId/candidateCustomerId + un flag "inverted" :
// c'est ici, côté serveur, que le sens définitif de la fusion est tranché.
export async function mergeCustomerAction(
  _prevState: MergeCustomerActionState,
  formData: FormData,
): Promise<MergeCustomerActionState> {
  const token = await requireSessionToken();
  const pageCustomerId = String(formData.get("pageCustomerId") ?? "").trim();
  const candidateCustomerId = String(formData.get("candidateCustomerId") ?? "").trim();
  const inverted = formData.get("inverted") === "on";
  const confirmed = formData.get("confirmed") === "on";

  if (!pageCustomerId || !candidateCustomerId) {
    return { error: "Fusion impossible : identifiant de client manquant" };
  }
  // Défense en profondeur — le bouton du formulaire est déjà désactivé tant
  // que la case n'est pas cochée côté client, revérifié ici car un POST peut
  // toujours être rejoué sans passer par le JS du navigateur.
  if (!confirmed) {
    return { error: "Vous devez confirmer la fusion avant de continuer" };
  }

  const canonicalCustomerId = inverted ? candidateCustomerId : pageCustomerId;
  const duplicateCustomerId = inverted ? pageCustomerId : candidateCustomerId;

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

  // Si le sens est inversé, la fiche actuellement affichée (pageCustomerId)
  // est celle qui vient d'être supprimée : rester sur cette page mènerait à
  // un 404. On redirige vers la fiche survivante (canonicalCustomerId).
  // Cas normal (non inversé) : pageCustomerId == canonicalCustomerId, la
  // page reste valide, pas de redirection nécessaire.
  if (inverted) {
    redirect(`/dashboard/customers/${canonicalCustomerId}`);
  }

  return null;
}
