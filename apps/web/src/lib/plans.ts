// Paliers commerciaux (H1, ADR-074, ADR-106) — miroir de ce que trust-api
// APPLIQUE : plan-features-grid.ts pour les limites, commission-grid.ts pour
// les taux. La spec ci-contre confronte les deux fichiers ligne à ligne, pour
// qu'un écart entre ce qu'on affiche et ce qu'on facture soit impossible à
// livrer.
//
// LES TAUX VIENNENT DU CODE, PAS DE LA PLAQUETTE. La grille produit en
// circulation annonçait 1,6 / 1,1 / 0,8 / 0,6 % ; le code prélève 2,00 / 1,50 /
// 1,20 / 1,00 %. Elle datait d'avant la correction du frais Djomy (1,0 % →
// 1,4 %) et n'avait pas été mise à jour. Publier ses chiffres aurait promis un
// tarif que la plateforme ne pratique pas.
//
// LES PRIX, EUX, N'ONT AUCUNE SOURCE DANS LE CODE : aucun montant d'abonnement
// n'existe côté trust-api. Ceux ci-dessous viennent de la grille produit, seule
// source disponible — ils ne sont donc contrôlés par aucun test, contrairement
// aux taux et aux limites.

export const TIER_ORDER = [
  "freemium",
  "starter",
  "starter_plus",
  "pro",
  "enterprise",
  "custom",
] as const;

export type Tier = (typeof TIER_ORDER)[number];

export const TIER_LABELS: Record<Tier, string> = {
  freemium: "Freemium",
  starter: "Starter",
  starter_plus: "Starter Plus",
  pro: "Pro",
  enterprise: "Enterprise",
  custom: "Custom Volume",
};

/** Abonnement mensuel, en centimes GNF. Source : grille produit. */
export const PRIX_MENSUEL_CENTIMES: Record<Tier, string> = {
  freemium: "0",
  starter: "10000000",
  starter_plus: "25000000",
  pro: "50000000",
  enterprise: "75000000",
  custom: "150000000",
};

/** Commission plateforme en points de base — miroir de COMMISSION_BPS_BY_TIER. */
export const COMMISSION_BPS: Record<Tier, number> = {
  freemium: 210,
  starter: 200,
  starter_plus: 175,
  pro: 150,
  enterprise: 120,
  custom: 100,
};

/** Plafond de commission par encaissement, en centimes GNF — miroir de
 *  COMMISSION_CAP_CENTIMES_BY_TIER. C'est un argument commercial fort sur les
 *  gros montants : à 1,50 %, une facture de 50 M GNF serait facturée 750 000 —
 *  le plafond la ramène à 75 000. */
export const COMMISSION_CAP_CENTIMES: Record<Tier, string> = {
  freemium: "5000000",
  starter: "5000000",
  starter_plus: "5000000",
  pro: "7500000",
  enterprise: "10000000",
  custom: "15000000",
};

/** Frais de passerelle Djomy, en points de base (ADR-072, réel mesuré 1,4 %).
 *  Supporté par le PAYEUR, en plus de la commission plateforme. */
export const FRAIS_PASSERELLE_BPS = 140;

/** null = illimité. */
export const MAX_BRANCHES_BY_TIER: Record<Tier, number | null> = {
  freemium: 1,
  starter: 2,
  starter_plus: 5,
  pro: null,
  enterprise: null,
  custom: null,
};

export const MAX_MEMBERS_BY_TIER: Record<Tier, number | null> = {
  freemium: 1,
  starter: 4,
  starter_plus: 7,
  pro: 10,
  enterprise: null,
  custom: null,
};

// Rôles dont l'accès dépend du palier. Un rôle absent est disponible dès
// Freemium. starter_plus n'en ouvre aucun de plus que starter — « sophistication
// restreinte, hors API » selon la grille produit.
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

/** Taux en pourcentage, à une ou deux décimales selon le besoin — « 1,75 % »,
 *  jamais « 1.75% » : la virgule décimale est la convention francophone. */
export function pourcentage(bps: number): string {
  const valeur = bps / 100;
  return `${valeur.toFixed(valeur % 1 === 0 ? 0 : 2).replace(".", ",")} %`;
}

/** Ce que supporte le payeur : commission plateforme + passerelle. */
export function totalPayeurBps(tier: Tier): number {
  return COMMISSION_BPS[tier] + FRAIS_PASSERELLE_BPS;
}

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
 *  correspond à une limite RÉELLEMENT appliquée par trust-api. */
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
