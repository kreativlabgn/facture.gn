// Paliers commerciaux (H1) — miroir de la grille appliquée côté trust-api
// (common/plan-features-grid.ts). Repris ici plutôt qu'importés : il n'y a pas
// de paquet de types partagés dans ce monorepo, et la spec ci-contre confronte
// ligne à ligne ce fichier au vrai grid, pour qu'une limite modifiée côté
// backend ne laisse pas l'écran mentir.
//
// AUCUN PRIX ICI, et ce n'est pas un oubli : il n'en existe nulle part dans le
// dépôt. Ni dans le schéma, ni dans les grilles hardcodées (commission-grid,
// revenue-share-grid, plan-features-grid), ni dans docs/. Le document
// « Grille-Offres-facture-gn.md » est cité en commentaire mais absent du dépôt.
// Afficher « 50 000 GNF/mois » serait un chiffre inventé sur un écran
// d'abonnement — la pire place pour en inventer un.

export const TIER_ORDER = ["freemium", "starter", "pro", "enterprise", "custom"] as const;

export type Tier = (typeof TIER_ORDER)[number];

export const TIER_LABELS: Record<Tier, string> = {
  freemium: "Freemium",
  starter: "Starter",
  pro: "Pro",
  enterprise: "Enterprise",
  custom: "Sur mesure",
};

/** null = illimité, tel que l'exprime la grille backend. */
export const MAX_BRANCHES_BY_TIER: Record<Tier, number | null> = {
  freemium: 1,
  starter: 2,
  pro: null,
  enterprise: null,
  custom: null,
};

export const MAX_MEMBERS_BY_TIER: Record<Tier, number | null> = {
  freemium: 1,
  starter: 4,
  pro: 10,
  enterprise: null,
  custom: null,
};

// Rôles dont l'accès dépend du palier. Un rôle absent est disponible dès
// Freemium. `business_manager` n'y figure pas : ce n'est pas un rôle
// d'organisation dans ce dépôt mais un Mandate.grantedRole.
export const MIN_TIER_FOR_ROLE: Record<string, Tier> = {
  inventory_manager: "starter",
  approver: "pro",
  auditor: "pro",
  developer_api: "pro",
};

export const ADVANCED_CUSTOMER_MANAGEMENT_MIN_TIER: Tier = "pro";

export function tierIndex(tier: string): number {
  return (TIER_ORDER as readonly string[]).indexOf(tier);
}

export function tierLabel(tier: string): string {
  return TIER_LABELS[tier as Tier] ?? tier;
}

// `illimite` est passé en toutes lettres plutôt que composé : « succursales »
// est féminin, « membres » masculin, et un accord codé en dur produisait
// « succursales illimités ».
function limite(
  valeur: number | null,
  singulier: string,
  pluriel: string,
  illimite: string,
): string {
  if (valeur === null) return illimite;
  return `${valeur} ${valeur > 1 ? pluriel : singulier}`;
}

/** Ce que ce palier donne, formulé du point de vue du commerçant. Chaque ligne
 *  correspond à une limite RÉELLEMENT appliquée par trust-api — jamais une
 *  promesse marketing. */
export function avantagesDuPalier(tier: Tier): string[] {
  const avantages = [
    limite(MAX_BRANCHES_BY_TIER[tier], "succursale", "succursales", "Succursales illimitées"),
    limite(
      MAX_MEMBERS_BY_TIER[tier],
      "membre d'équipe",
      "membres d'équipe",
      "Membres d'équipe illimités",
    ),
  ];

  const roles = Object.entries(MIN_TIER_FOR_ROLE)
    .filter(([, minimum]) => tierIndex(tier) >= tierIndex(minimum))
    .map(([role]) => ROLE_LABELS[role] ?? role);
  if (roles.length > 0) {
    avantages.push(`Rôles ${roles.join(", ")}`);
  }

  if (tierIndex(tier) >= tierIndex(ADVANCED_CUSTOMER_MANAGEMENT_MIN_TIER)) {
    avantages.push("Gestion client avancée — fusion de doublons, plafonds de crédit");
  }

  return avantages;
}

const ROLE_LABELS: Record<string, string> = {
  inventory_manager: "gestionnaire de stock",
  approver: "approbateur",
  auditor: "auditeur",
  developer_api: "développeur API",
};
