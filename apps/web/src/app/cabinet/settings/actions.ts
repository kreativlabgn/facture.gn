"use server";

import { revalidatePath } from "next/cache";
import { resolveActivePractice } from "@/lib/active-practice";
import { requireSessionToken } from "@/lib/session";
import {
  PARTNER_TIERS,
  SETTLEMENT_MODES,
  TrustApiError,
  upgradePartnerTier,
  upgradeSettlementMode,
  type PartnerTier,
  type SettlementMode,
} from "@/lib/trust-api";

export type ReglagesActionState = { error: string } | { ok: string } | null;

// Le cabinet ciblé est toujours le cabinet ACTIF, jamais un identifiant venu du
// formulaire : un champ caché serait modifiable par l'appelant, et il désigne
// ici la structure dont on change les conditions commerciales.
//
// La garde qui compte reste trust-api (assertPracticeAdmin) : ces actions ne
// font que relayer son 403 en message lisible.

export async function changerPalierAction(
  _prev: ReglagesActionState,
  formData: FormData,
): Promise<ReglagesActionState> {
  const token = await requireSessionToken();
  const { active } = await resolveActivePractice(token);
  if (!active) {
    return { error: "Aucun cabinet actif." };
  }

  const tier = String(formData.get("tier") ?? "");
  // Revalidé ici ET par le DTO Zod côté serveur. Ce contrôle-ci évite un
  // aller-retour perdu, il ne remplace rien.
  if (!PARTNER_TIERS.includes(tier as PartnerTier)) {
    return { error: "Palier inconnu." };
  }

  try {
    await upgradePartnerTier(token, active.id, tier as PartnerTier);
  } catch (error) {
    if (error instanceof TrustApiError) {
      return { error: error.message };
    }
    return { error: "Changement de palier temporairement indisponible." };
  }

  revalidatePath("/cabinet/settings");
  revalidatePath("/cabinet");
  return { ok: "Palier partenaire mis à jour." };
}

export async function changerModeReversementAction(
  _prev: ReglagesActionState,
  formData: FormData,
): Promise<ReglagesActionState> {
  const token = await requireSessionToken();
  const { active } = await resolveActivePractice(token);
  if (!active) {
    return { error: "Aucun cabinet actif." };
  }

  const mode = String(formData.get("mode") ?? "");
  if (!SETTLEMENT_MODES.includes(mode as SettlementMode)) {
    return { error: "Mode inconnu." };
  }

  try {
    await upgradeSettlementMode(token, active.id, mode as SettlementMode);
  } catch (error) {
    if (error instanceof TrustApiError) {
      return { error: error.message };
    }
    return { error: "Changement de mode temporairement indisponible." };
  }

  revalidatePath("/cabinet/settings");
  return {
    ok: "Mode de reversement mis à jour. Les commissions déjà générées ne changent pas.",
  };
}
