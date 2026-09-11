import { normaliserMsisdnGn } from "./phone-gn";

// ── Numéros Mobile Money guinéens (Chantier 3) ──────────────────────────────
//
// La normalisation elle-même n'est PAS réécrite ici : phone-gn.ts la porte déjà
// et dit pourquoi elle doit rester unique (« LA NORMALISATION EST ICI, ET NULLE
// PART AILLEURS »). Deux implémentations du même passage à la forme canonique
// finiraient par diverger sur un cas limite, et c'est précisément ce que ce
// module-là existe pour empêcher.
//
// Ce fichier ajoute la seule contrainte que le Mobile Money impose en plus : le
// numéro doit être un MOBILE. phone-gn accepte 8 ou 9 chiffres (le plan
// guinéen contient des fixes), alors qu'un compte Orange Money ou MTN MoMo est
// forcément adossé à une ligne mobile — 9 chiffres commençant par 6. Envoyer
// une sollicitation de débit sur un fixe ne produirait rien, sinon un payeur
// qui attend une notification qui n'arrivera jamais.

/** Plan de numérotation MOBILE guinéen, en forme canonique. */
const MOBILE_CANONIQUE = /^\+224[6]\d{8}$/;

export type OperateurMobileMoney = "orange_money" | "mtn_momo";

export const OPERATEURS: ReadonlyArray<{ valeur: OperateurMobileMoney; label: string }> = [
  { valeur: "orange_money", label: "Orange Money" },
  { valeur: "mtn_momo", label: "MTN MoMo" },
];

export function estOperateurConnu(valeur: string): valeur is OperateurMobileMoney {
  return OPERATEURS.some((operateur) => operateur.valeur === valeur);
}

export type NormalisationMsisdn = { ok: true; msisdn: string } | { ok: false; erreur: string };

// L'OPÉRATEUR N'EST PAS DÉDUIT DU PRÉFIXE, et c'est délibéré : la portabilité
// des numéros existe en Guinée, un 62x n'est donc plus une preuve de réseau.
// Deviner exposerait le payeur à voir sa demande partir chez le mauvais
// opérateur, sans qu'il comprenne pourquoi rien n'arrive sur son téléphone. Il
// déclare son réseau lui-même — lui seul le sait avec certitude.
export function normaliserMsisdn(brut: string): NormalisationMsisdn {
  if (brut.trim().length === 0) {
    return { ok: false, erreur: "Entrez le numéro qui doit être débité." };
  }

  const canonique = normaliserMsisdnGn(brut);
  if (canonique === null) {
    return {
      ok: false,
      erreur: "Numéro guinéen attendu, par exemple 622 00 00 00.",
    };
  }

  // Distinguer ce refus-ci du précédent a une valeur : le payeur a bien saisi
  // un numéro guinéen valide, on lui dit que c'est le TYPE de ligne qui ne
  // convient pas, pas sa façon d'écrire.
  if (!MOBILE_CANONIQUE.test(canonique)) {
    return {
      ok: false,
      erreur: "Le Mobile Money exige un numéro mobile : 9 chiffres commençant par 6.",
    };
  }

  return { ok: true, msisdn: canonique };
}

// Affichage groupé « +224 622 00 00 00 » — pour renvoyer au payeur le numéro que
// nous avons compris, avant qu'il ne confirme un débit dessus.
export function formaterMsisdn(msisdn: string): string {
  const groupes = msisdn.match(/^\+224(\d{3})(\d{2})(\d{2})(\d{2})$/);
  if (!groupes) {
    return msisdn;
  }
  const [, a, b, c, d] = groupes;
  return `+224 ${a} ${b} ${c} ${d}`;
}
