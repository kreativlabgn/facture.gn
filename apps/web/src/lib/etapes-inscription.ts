import type { EspaceId } from "./espaces";

// Le tunnel d'inscription tient en DEUX écrans : le compte (/register, commun
// aux deux profils professionnels — un seul type de compte, voir
// lib/espaces.ts lignes 16-23) puis la structure, propre à chacun —
// l'organisation marchande (/onboarding) ou le cabinet (/nouveau-cabinet).
//
// Le libellé de chaque écran et l'aperçu affiché à l'écran 1 viennent d'UNE
// seule table, lue par /register, /onboarding et /nouveau-cabinet — même
// principe que ESPACES (lib/espaces.ts) pour les portes publiques et
// AUTH_CONTEXTES (lib/auth-contexte.ts) pour la zone d'information d'AuthLayout.
// Volontairement une table SÉPARÉE de AUTH_CONTEXTES : celle-ci alimente aussi
// /login, où un indicateur d'étape n'a pas de sens (se connecter n'est pas
// entrer dans un tunnel).
//
// RÈGLE D'ÉCRITURE (identique à auth-contexte.ts, lignes 7-13) : `apercu` ne
// promet que ce que l'écran 2 demande RÉELLEMENT — vérifié contre les champs
// de OnboardingForm.tsx (nom, forme légale, régime fiscal) et PracticeForm.tsx
// (nom, type de structure, téléphone) avant d'écrire cette phrase ;
// etapes-inscription.spec.ts relit ces formulaires pour empêcher la dérive.
//
// L'acheteur n'a pas de second écran (lib/espaces.ts : aucun compte à créer,
// une seule action) — il n'apparaît donc pas ici.

export type EtapeId = "compte" | "structure";

export type ProfilTunnel = Exclude<EspaceId, "acheteur">;

export type EtapesInscription = {
  /** Libellé de l'écran 1 — identique pour les deux profils, même formulaire de compte. */
  compte: string;
  /** Libellé de l'écran 2 — propre au profil. */
  structure: string;
  /** Ce que l'écran 2 va réellement demander, en une phrase courte — affiché
   *  sous la description de /register, jamais recopié ailleurs. */
  apercu: string;
};

export const ETAPES_INSCRIPTION: Record<ProfilTunnel, EtapesInscription> = {
  marchand: {
    compte: "Votre compte",
    structure: "Votre organisation",
    apercu:
      "L'étape suivante vous demandera la forme légale de votre organisation et son régime fiscal.",
  },
  cabinet: {
    compte: "Votre compte",
    structure: "Votre cabinet",
    apercu: "L'étape suivante vous demandera le nom de votre cabinet et son type de structure.",
  },
};

/** Numéro affiché (« Étape X sur 2 ») et libellé associé, pour un profil et un
 *  écran donnés. Logique pure, testée sans rendu — même discipline que
 *  cabinet-nav.ts. */
export function etapeLabel(
  profil: ProfilTunnel,
  etape: EtapeId,
): { numero: 1 | 2; libelle: string } {
  const table = ETAPES_INSCRIPTION[profil];
  return etape === "compte" ? { numero: 1, libelle: table.compte } : { numero: 2, libelle: table.structure };
}
