"use server";

import { revalidatePath } from "next/cache";
import { requireSessionToken } from "@/lib/session";
import { acceptMandateRequest, listMyPractices, requestMandate, revokeMandate, TrustApiError } from "@/lib/trust-api";

export type RequestMandateActionState = { error: string } | null;

export async function requestMandateAction(
  _prevState: RequestMandateActionState,
  formData: FormData,
): Promise<RequestMandateActionState> {
  const token = await requireSessionToken();
  const practices = await listMyPractices(token);
  const practice = practices[0];
  if (!practice) {
    return { error: "Aucun cabinet associé à ce compte" };
  }

  const organizationId = String(formData.get("organizationId") ?? "").trim();
  if (!organizationId) {
    return { error: "L'identifiant de l'organisation est requis" };
  }

  try {
    await requestMandate(token, practice.id, organizationId);
  } catch (error) {
    if (error instanceof TrustApiError) {
      return { error: error.message };
    }
    return { error: "Demande temporairement indisponible" };
  }

  revalidatePath("/cabinet/mandates");
  return null;
}

// Formulaires sans état de pending suivi (boutons "Révoquer"/"Accepter" dans une
// liste, pas un formulaire de saisie) — server actions directement passées en
// `action` de <form>, aucun composant client requis (progressive enhancement
// standard Next.js).
export async function revokeMandateAction(formData: FormData): Promise<void> {
  const token = await requireSessionToken();
  const practices = await listMyPractices(token);
  const practice = practices[0];
  const mandateId = String(formData.get("mandateId") ?? "");
  if (!practice || !mandateId) {
    return;
  }

  await revokeMandate(token, practice.id, mandateId);
  revalidatePath("/cabinet/mandates");
}

export async function acceptMandateRequestAction(formData: FormData): Promise<void> {
  const token = await requireSessionToken();
  const practices = await listMyPractices(token);
  const practice = practices[0];
  const mandateId = String(formData.get("mandateId") ?? "");
  if (!practice || !mandateId) {
    return;
  }

  await acceptMandateRequest(token, practice.id, mandateId);
  revalidatePath("/cabinet/mandates");
}
