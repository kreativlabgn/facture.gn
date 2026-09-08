"use server";

import { revalidatePath } from "next/cache";
import { resolveActivePractice } from "@/lib/active-practice";
import { requireSessionToken } from "@/lib/session";
import { inviteMember, revokePracticeMember, TrustApiError } from "@/lib/trust-api";

export type InviteMemberActionState = { error: string } | null;
export type RevokeMemberActionState = { error: string } | { ok: string } | null;

// DÉPART D'UN COLLABORATEUR. Le cabinet ciblé est toujours le cabinet ACTIF,
// jamais un identifiant venu du formulaire : celui-ci ne porte que la personne
// à retirer. La garde qui compte reste trust-api (assertPracticeAdmin, plus le
// refus de retirer le dernier administrateur) — cette action ne fait que
// relayer ses messages.
export async function revokeMemberAction(
  _prev: RevokeMemberActionState,
  formData: FormData,
): Promise<RevokeMemberActionState> {
  const token = await requireSessionToken();
  const { active: practice } = await resolveActivePractice(token);
  if (!practice) {
    return { error: "Aucun cabinet associé à ce compte" };
  }

  const memberUserId = String(formData.get("memberUserId") ?? "").trim();
  if (!memberUserId) {
    return { error: "Collaborateur introuvable" };
  }

  try {
    await revokePracticeMember(token, practice.id, memberUserId);
  } catch (error) {
    if (error instanceof TrustApiError) {
      return { error: error.message };
    }
    return { error: "Retrait temporairement indisponible" };
  }

  revalidatePath("/cabinet/members");
  revalidatePath("/cabinet");
  return { ok: "Collaborateur retiré. Ses accès aux clients du cabinet sont coupés." };
}

export async function inviteMemberAction(
  _prevState: InviteMemberActionState,
  formData: FormData,
): Promise<InviteMemberActionState> {
  const token = await requireSessionToken();
  const { active: practice } = await resolveActivePractice(token);
  if (!practice) {
    return { error: "Aucun cabinet associé à ce compte" };
  }

  const msisdn = String(formData.get("msisdn") ?? "").trim();
  if (!msisdn) {
    return { error: "Le numéro de téléphone est requis" };
  }

  try {
    await inviteMember(token, practice.id, msisdn);
  } catch (error) {
    if (error instanceof TrustApiError) {
      return { error: error.message };
    }
    return { error: "Invitation temporairement indisponible" };
  }

  revalidatePath("/cabinet/members");
  return null;
}
