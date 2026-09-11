import type { CommercialTier, OrganizationRole } from "@facture-gn/db";

// Grille des paliers Trust (H1, Grille-Offres-facture-gn.md §2) — hardcodée,
// même pattern que commission-grid.ts / revenue-share-grid.ts (ADR-058 jamais
// scaffoldée). Seules les fonctionnalités qui existent réellement en code sont
// gatées ici — jamais récurrence/rappels/branding/UBL/analytics avancé (I1/I2
// non livrées, aucun branding/UBL/analytics avancé construit dans ce repo).
// "Starter Plus" (ADR-106) a rejoint l'enum CommercialTier le 2026-09-07
// (migration 20260907070000) : le gap signalé ici depuis H1 est comblé.
// Exporté uniquement pour le test de garde-fou (plan-features-grid.spec.ts)
// qui vérifie sa cohérence avec l'enum Prisma CommercialTier — jamais consommé
// par un autre service, qui doit toujours passer par les fonctions ci-dessous.
export const TIER_ORDER: CommercialTier[] = [
  "freemium",
  "starter",
  "starter_plus",
  "pro",
  "enterprise",
  "custom",
];

// null = illimité.
const MAX_BRANCHES_BY_TIER: Record<CommercialTier, number | null> = {
  freemium: 1,
  starter: 2,
  starter_plus: 5,
  pro: null,
  enterprise: null,
  custom: null,
};

const MAX_MEMBERS_BY_TIER: Record<CommercialTier, number | null> = {
  freemium: 1,
  starter: 4,
  starter_plus: 7,
  pro: 10,
  enterprise: null,
  custom: null,
};

// Un rôle absent de cette table est disponible dès Freemium (rôles de base +
// conformité, §2.1). business_manager n'y figure pas volontairement : ce n'est
// pas un OrganizationRole dans ce repo (c'est un Mandate.grantedRole, jamais
// assignable via inviteMember()).
// starter_plus n'ouvre AUCUN rôle nouveau : la grille produit le décrit comme
// « sophistication restreinte (hors API) ». Il hérite simplement de starter,
// puisque tierIndex(starter_plus) > tierIndex(starter) — aucune entrée à
// ajouter ici, et developer_api reste à pro.
const MIN_TIER_FOR_ROLE: Partial<Record<OrganizationRole, CommercialTier>> = {
  inventory_manager: "starter",
  approver: "pro",
  auditor: "pro",
  developer_api: "pro",
};

export const ADVANCED_CUSTOMER_MANAGEMENT_MIN_TIER: CommercialTier = "pro";

// ADR-107 — passerelle PDP (API publique ouverte aux ERP tiers). Palier
// minimal : enterprise, ce qui n'ouvre l'accès qu'à enterprise et custom, les
// deux derniers de TIER_ORDER.
//
// Exprimé comme un SEUIL et non comme une liste ["enterprise", "custom"] : une
// liste devrait être retrouvée et complétée à chaque palier ajouté au-dessus
// (starter_plus a déjà montré que la grille bouge, ADR-106), et l'oublier ferait
// silencieusement perdre l'accès à un client qui vient de monter en gamme. Le
// seuil, lui, reste juste par construction.
//
// Accès DISTINCT du rôle developer_api (pro, ci-dessus) : ce dernier permet à un
// membre de fabriquer une clé pour ses propres scripts ; celui-ci autorise un
// éditeur externe à déposer des documents fiscaux au nom de la PME.
export const PDP_GATEWAY_MIN_TIER: CommercialTier = "enterprise";

function tierIndex(tier: CommercialTier): number {
  return TIER_ORDER.indexOf(tier);
}

export function isRoleAllowedForTier(role: OrganizationRole, tier: CommercialTier): boolean {
  const minTier = MIN_TIER_FOR_ROLE[role];
  if (!minTier) {
    return true;
  }
  return tierIndex(tier) >= tierIndex(minTier);
}

export function maxBranchesForTier(tier: CommercialTier): number | null {
  return MAX_BRANCHES_BY_TIER[tier];
}

export function maxMembersForTier(tier: CommercialTier): number | null {
  return MAX_MEMBERS_BY_TIER[tier];
}

export function isAdvancedCustomerManagementAllowed(tier: CommercialTier): boolean {
  return tierIndex(tier) >= tierIndex(ADVANCED_CUSTOMER_MANAGEMENT_MIN_TIER);
}

export function isPdpGatewayAllowed(tier: CommercialTier): boolean {
  return tierIndex(tier) >= tierIndex(PDP_GATEWAY_MIN_TIER);
}
