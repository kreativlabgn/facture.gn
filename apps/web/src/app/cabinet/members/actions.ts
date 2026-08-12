"use server";

import { revalidatePath } from "next/cache";
import { requireSessionToken } from "@/lib/session";
import { inviteMember, listMyPractices, TrustApiError } from "@/lib/trust-api";

export type InviteMemberActionState = { error: string } | null;

export async function inviteMemberAction(
  _prevState: InviteMemberActionState,
  formData: FormData,
): Promise<InviteMemberActionState> {
  const token = await requireSessionToken();
  const practices = await listMyPractices(token);
  const practice = practices[0];
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
