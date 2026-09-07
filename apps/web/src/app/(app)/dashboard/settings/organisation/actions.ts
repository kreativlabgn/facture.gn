"use server";

import { revalidatePath } from "next/cache";
import { resolveActiveOrganization } from "@/lib/active-organization";
import { requireSessionToken } from "@/lib/session";
import { TrustApiError, updateOrganization } from "@/lib/trust-api";

export type FicheActionState = { error: string } | { ok: string } | null;

// Modification de la fiche d'identité légale.
//
// L'organisation ciblée est l'organisation ACTIVE (OrgSwitcher), jamais un id
// venu du formulaire : un champ caché serait modifiable par l'appelant, et
// c'est exactement le genre de chose qu'on ne veut pas laisser au client sur
// une fiche qui engage l'entreprise devant la DGI.
export async function updateOrganizationAction(
  _prev: FicheActionState,
  formData: FormData,
): Promise<FicheActionState> {
  const token = await requireSessionToken();
  const { active } = await resolveActiveOrganization(token);
  if (!active) {
    return { error: "Aucune organisation active." };
  }

  const texte = (champ: string) => String(formData.get(champ) ?? "").trim();

  // Un champ vidé au formulaire signifie EFFACER : on envoie `null`, que le
  // DTO distingue de `undefined` (ne pas toucher). Sans ça, un NIF saisi par
  // erreur resterait à vie.
  const nif = texte("nif");
  const etaxNumber = texte("etaxNumber");
  const rccm = texte("rccm");

  try {
    await updateOrganization(token, active.id, {
      name: texte("name"),
      legalForm: texte("legalForm"),
      regimeFiscal: texte("regimeFiscal"),
      nif: nif || null,
      etaxNumber: etaxNumber || null,
      rccm: rccm || null,
    });
  } catch (error) {
    if (error instanceof TrustApiError) {
      return { error: error.message };
    }
    return { error: "Modification temporairement indisponible." };
  }

  revalidatePath("/dashboard/settings/organisation");
  revalidatePath("/dashboard/settings");
  return { ok: "Fiche mise à jour." };
}
