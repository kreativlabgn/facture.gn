"use server";

import { revalidatePath } from "next/cache";
import { resolveActiveOrganization } from "@/lib/active-organization";
import { requireSessionToken } from "@/lib/session";
import { TrustApiError, activateReferral, attachReferral } from "@/lib/trust-api";

export type ParrainageActionState = { error: string } | { ok: string } | null;

// L'organisation ciblée est toujours l'organisation ACTIVE, jamais un id venu
// du formulaire : ici il désignerait qui touche la prime.

export async function activerParrainageAction(): Promise<ParrainageActionState> {
  const token = await requireSessionToken();
  const { active } = await resolveActiveOrganization(token);
  if (!active) {
    return { error: "Aucune organisation active." };
  }

  try {
    await activateReferral(token, active.id);
  } catch (error) {
    if (error instanceof TrustApiError) {
      return { error: error.message };
    }
    return { error: "Activation temporairement indisponible." };
  }

  revalidatePath("/dashboard/parrainage");
  return { ok: "Programme activé." };
}

export async function rattacherParrainAction(
  _prev: ParrainageActionState,
  formData: FormData,
): Promise<ParrainageActionState> {
  const token = await requireSessionToken();
  const { active } = await resolveActiveOrganization(token);
  if (!active) {
    return { error: "Aucune organisation active." };
  }

  // Normalisé ici ET côté DTO : un code se dicte au téléphone, personne ne
  // respecte la casse. La double normalisation évite un aller-retour perdu.
  const code = String(formData.get("code") ?? "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z2-7]{6}$/.test(code)) {
    return { error: "Un code de parrainage compte 6 caractères (A-Z, 2-7)." };
  }

  try {
    await attachReferral(token, active.id, code);
  } catch (error) {
    if (error instanceof TrustApiError) {
      return { error: error.message };
    }
    return { error: "Rattachement temporairement indisponible." };
  }

  revalidatePath("/dashboard/parrainage");
  return { ok: "Parrain enregistré. La prime sera versée à votre premier abonnement payant." };
}
