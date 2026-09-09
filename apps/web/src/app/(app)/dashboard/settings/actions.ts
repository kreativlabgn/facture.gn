"use server";

import { revalidatePath } from "next/cache";
import { requireSessionToken } from "@/lib/session";
import { resolveActiveOrganization } from "@/lib/active-organization";
import { normaliserMsisdnGn } from "@/lib/phone-gn";
import {
  createApiKey,
  createBranch,
  inviteOrganizationMember,
  revokeApiKey,
  revokeOrganizationMember,
  TrustApiError,
  type BranchType,
} from "@/lib/trust-api";

// Server Actions des onglets Paramètres.
//
// Aucune n'implémente de contrôle de rôle ni de quota : RolesGuard tranche
// côté trust-api, et la grille de palier y est APPLIQUÉE (branches.service,
// inviteMember). Le masquage côté page est du confort — la barrière est là-bas.
//
// Chaque action relaie le message du serveur tel quel quand il en donne un :
// « Palier freemium limité à 1 succursale(s) — upgrade requis » explique
// exactement ce qui s'est passé, là où un « Création impossible » générique
// laisserait le commerçant deviner.

export type SettingsActionState = { error: string } | { ok: string } | null;

/** Le secret d'une clé API n'est montré QU'UNE FOIS : il n'est jamais stocké en
 *  clair (argon2id côté serveur, comme un mot de passe). L'état de l'action est
 *  le seul endroit où il transite — jamais un rechargement de page, qui le
 *  ferait disparaître sans que personne l'ait copié. */
export type ApiKeyActionState = { error: string } | { ok: string; secret?: string } | null;

const BRANCH_TYPES: readonly BranchType[] = ["boutique", "entrepot", "agence", "en_ligne"];

async function contexte() {
  const token = await requireSessionToken();
  const { active: organization } = await resolveActiveOrganization(token);
  return { token, organization };
}

function rafraichir(): void {
  revalidatePath("/dashboard/settings");
}

export async function createBranchAction(
  _prevState: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const { token, organization } = await contexte();
  if (!organization) {
    return { error: "Aucune organisation associée à ce compte" };
  }

  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    return { error: "Le nom de la succursale est obligatoire" };
  }

  // Le type vient d'un <select> — mais un POST fabriqué n'a pas de <select>.
  // Le valider ici évite un 400 traduit depuis un message de schéma Zod.
  const type = String(formData.get("type") ?? "");
  if (!BRANCH_TYPES.includes(type as BranchType)) {
    return { error: "Type de succursale inconnu" };
  }

  try {
    await createBranch(token, organization.id, { name, type: type as BranchType });
  } catch (error) {
    if (error instanceof TrustApiError) {
      return { error: error.message };
    }
    return { error: "Création temporairement indisponible" };
  }

  rafraichir();
  return { ok: `Succursale « ${name} » créée.` };
}

export async function inviteMemberAction(
  _prevState: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const { token, organization } = await contexte();
  if (!organization) {
    return { error: "Aucune organisation associée à ce compte" };
  }

  // Même normalisation que la vente au comptoir : le serveur n'accepte que le
  // format canonique, et deux écritures du même numéro désigneraient deux
  // comptes différents à la résolution par UserPhone.
  const msisdn = normaliserMsisdnGn(String(formData.get("msisdn") ?? ""));
  if (!msisdn) {
    return { error: "Numéro de téléphone invalide — 9 chiffres attendus (ex. 622 00 00 00)" };
  }

  const role = String(formData.get("role") ?? "").trim();
  if (!role) {
    return { error: "Choisissez un rôle pour ce collaborateur" };
  }

  try {
    await inviteOrganizationMember(token, organization.id, { msisdn, role });
  } catch (error) {
    if (error instanceof TrustApiError) {
      // Couvre les trois refus du serveur, chacun avec son explication : quota
      // de palier atteint, rôle non débloqué par le palier, et « compte
      // introuvable » — l'invité doit déjà avoir un compte facture.gn.
      return { error: error.message };
    }
    return { error: "Invitation temporairement indisponible" };
  }

  rafraichir();
  return { ok: "Collaborateur ajouté." };
}

export async function revokeMemberAction(
  _prevState: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const { token, organization } = await contexte();
  if (!organization) {
    return { error: "Aucune organisation associée à ce compte" };
  }

  const memberId = String(formData.get("memberId") ?? "");
  if (!memberId) {
    return { error: "Révocation impossible : membre non identifié" };
  }

  try {
    await revokeOrganizationMember(token, organization.id, memberId);
  } catch (error) {
    if (error instanceof TrustApiError) {
      // Deux refus METIER remontent ici et méritent d'être lus : seul un owner
      // révoque un owner/admin/approver, et jamais le dernier propriétaire
      // actif — une organisation sans owner ne peut plus rien.
      return { error: error.message };
    }
    return { error: "Révocation temporairement indisponible" };
  }

  rafraichir();
  return { ok: "Accès retiré. La ligne reste datée au journal des membres." };
}

export async function createApiKeyAction(
  _prevState: ApiKeyActionState,
  formData: FormData,
): Promise<ApiKeyActionState> {
  const { token, organization } = await contexte();
  if (!organization) {
    return { error: "Aucune organisation associée à ce compte" };
  }

  const environment = String(formData.get("environment") ?? "");
  if (environment !== "production" && environment !== "sandbox") {
    return { error: "Environnement inconnu" };
  }

  try {
    const cle = await createApiKey(token, organization.id, environment);
    rafraichir();
    // Le secret remonte dans l'état, jamais dans la page rechargée : c'est la
    // seule et unique fois où il est lisible.
    return { ok: "Clé générée. Copiez-la maintenant — elle ne sera plus jamais affichée.", secret: cle.secret };
  } catch (error) {
    if (error instanceof TrustApiError) {
      return { error: error.message };
    }
    return { error: "Génération temporairement indisponible" };
  }
}

export async function revokeApiKeyAction(
  _prevState: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const { token, organization } = await contexte();
  if (!organization) {
    return { error: "Aucune organisation associée à ce compte" };
  }

  const apiKeyId = String(formData.get("apiKeyId") ?? "");
  if (!apiKeyId) {
    return { error: "Révocation impossible : clé non identifiée" };
  }

  try {
    await revokeApiKey(token, organization.id, apiKeyId);
  } catch (error) {
    if (error instanceof TrustApiError) {
      return { error: error.message };
    }
    return { error: "Révocation temporairement indisponible" };
  }

  rafraichir();
  return { ok: "Clé révoquée. Les appels qui l'utilisaient sont refusés dès maintenant." };
}
