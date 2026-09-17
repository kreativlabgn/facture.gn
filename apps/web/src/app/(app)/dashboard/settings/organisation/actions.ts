"use server";

import { revalidatePath } from "next/cache";
import { resolveActiveOrganization } from "@/lib/active-organization";
import { requireSessionToken } from "@/lib/session";
import { setWhatsappOcrChannel, TrustApiError, updateOrganization } from "@/lib/trust-api";

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

export type WhatsappOcrActionState = { error: string } | { ok: string } | null;

// Bascule du canal WhatsApp de saisie OCR (plan 2026-09-16, OCR multicanal
// vocal/WhatsApp, clarification 7). Même garde que updateOrganizationAction
// ci-dessus : l'organisation ciblée est TOUJOURS l'organisation active résolue
// côté serveur, jamais un id de formulaire — activer ce canal donne à
// n'importe quel employé le pouvoir de créer des brouillons de facture pour
// l'organisation, ce n'est pas un réglage à laisser dériver vers un id
// falsifiable.
export async function setWhatsappOcrChannelAction(
  _prev: WhatsappOcrActionState,
  formData: FormData,
): Promise<WhatsappOcrActionState> {
  const token = await requireSessionToken();
  const { active } = await resolveActiveOrganization(token);
  if (!active) {
    return { error: "Aucune organisation active." };
  }

  // Case décochée = absente du FormData : se lit comme `false`, jamais comme
  // "ne pas toucher" — même discipline que isActive côté fiche produit.
  const enabled = formData.get("whatsappOcrEnabled") === "on";

  try {
    await setWhatsappOcrChannel(token, active.id, enabled);
  } catch (error) {
    if (error instanceof TrustApiError) {
      return { error: error.message };
    }
    return { error: "Modification temporairement indisponible." };
  }

  revalidatePath("/dashboard/settings/organisation");
  revalidatePath("/dashboard/settings");
  return { ok: enabled ? "Canal WhatsApp activé." : "Canal WhatsApp désactivé." };
}
