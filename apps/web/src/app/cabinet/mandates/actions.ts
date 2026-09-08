"use server";

import { revalidatePath } from "next/cache";
import { resolveActivePractice } from "@/lib/active-practice";
import { requireSessionToken } from "@/lib/session";
import {
  acceptMandateRequest,
  lookupOrganizationByNif,
  requestMandate,
  revokeMandate,
  TrustApiError,
} from "@/lib/trust-api";

// Le formulaire de demande de mandat se fait en deux temps — vérifier le NIF,
// puis envoyer la demande — mais avec UNE SEULE Server Action et un seul
// <form>. Deux boutons de soumission portant `name="intent"` suffisent à les
// distinguer : le navigateur n'envoie que la valeur du bouton cliqué, sans une
// ligne de JavaScript. Deux formulaires imbriqués seraient invalides en HTML,
// et deux actions séparées perdraient l'état entre les deux étapes sur un
// mobile sans JS.
export type RequestMandateActionState = {
  // Réaffiché dans le champ après un aller-retour serveur : sans JS, la page
  // est re-rendue et la saisie serait perdue autrement.
  nif?: string;
  // Renseignée une fois le NIF résolu — c'est elle qui débloque l'envoi.
  organization?: { id: string; name: string };
  // Nom de l'organisation dont la demande vient de partir (message de succès).
  requestedFor?: string;
  error?: string;
} | null;

export async function requestMandateAction(
  _prevState: RequestMandateActionState,
  formData: FormData,
): Promise<RequestMandateActionState> {
  const token = await requireSessionToken();
  const { active: practice } = await resolveActivePractice(token);
  if (!practice) {
    return { error: "Aucun cabinet associé à ce compte" };
  }

  const nif = String(formData.get("nif") ?? "").trim();
  const intent = String(formData.get("intent") ?? "verify");

  if (intent !== "request") {
    if (!nif) {
      return { nif, error: "Renseignez le NIF de l'organisation cliente" };
    }
    try {
      const organization = await lookupOrganizationByNif(token, nif);
      return { nif, organization };
    } catch (error) {
      if (error instanceof TrustApiError) {
        return { nif, error: error.message };
      }
      return { nif, error: "Recherche temporairement indisponible" };
    }
  }

  // Envoi de la demande. L'identifiant vient du champ caché posé à l'étape
  // précédente : il est donc modifiable par le client. Ce n'est pas un trou —
  // trust-api revérifie l'existence de l'organisation ET exige un
  // practice_admin (assertPracticeAdmin) à la création du mandat. Le champ
  // caché est un confort de formulaire, jamais une autorisation.
  const organizationId = String(formData.get("organizationId") ?? "").trim();
  const organizationName = String(formData.get("organizationName") ?? "").trim();
  if (!organizationId) {
    return { nif, error: "Vérifiez d'abord le NIF avant d'envoyer la demande" };
  }

  try {
    await requestMandate(token, practice.id, organizationId);
  } catch (error) {
    if (error instanceof TrustApiError) {
      return { nif, organization: { id: organizationId, name: organizationName }, error: error.message };
    }
    return {
      nif,
      organization: { id: organizationId, name: organizationName },
      error: "Demande temporairement indisponible",
    };
  }

  revalidatePath("/cabinet/mandates");
  // État remis à zéro : le formulaire redevient vierge pour le client suivant,
  // et le nom part dans le message de confirmation.
  return { requestedFor: organizationName };
}

export async function revokeMandateAction(formData: FormData): Promise<void> {
  const token = await requireSessionToken();
  const { active: practice } = await resolveActivePractice(token);
  const mandateId = String(formData.get("mandateId") ?? "");
  if (!practice || !mandateId) {
    return;
  }

  await revokeMandate(token, practice.id, mandateId);
  revalidatePath("/cabinet/mandates");
}

export async function acceptMandateRequestAction(formData: FormData): Promise<void> {
  const token = await requireSessionToken();
  const { active: practice } = await resolveActivePractice(token);
  const mandateId = String(formData.get("mandateId") ?? "");
  if (!practice || !mandateId) {
    return;
  }

  await acceptMandateRequest(token, practice.id, mandateId);
  revalidatePath("/cabinet/mandates");
}
