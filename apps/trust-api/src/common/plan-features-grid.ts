import type { CommercialTier, OrganizationRole } from "@facture-gn/db";

// Grille des paliers Trust (H1, Grille-Offres-facture-gn.md §2) — hardcodée,
// même pattern que commission-grid.ts / revenue-share-grid.ts (ADR-058 jamais
// scaffoldée). Seules les fonctionnalités qui existent réellement en code sont
// gatées ici — jamais récurrence/rappels/branding/UBL/analytics avancé (I1/I2
// non livrées, aucun branding/UBL/analytics avancé construit dans ce repo).
// "Starter Plus" (ADR-106, 6e palier commercial) n'existe pas dans l'enum
// CommercialTier (5 paliers) — gap hors scope H1, voir
// docs/plans/2026-08-19-plan-feature-gating.md.
// Exporté uniquement pour le test de garde-fou (plan-features-grid.spec.ts)
// qui vérifie sa cohérence avec l'enum Prisma CommercialTier — jamais consommé
// par un autre service, qui doit toujours passer par les fonctions ci-dessous.
export const TIER_ORDER: CommercialTier[] = ["freemium", "starter", "pro", "enterprise", "custom"];

// null = illimité.
const MAX_BRANCHES_BY_TIER: Record<CommercialTier, number | null> = {
  freemium: 1,
  starter: 2,
  pro: null,
  enterprise: null,
  custom: null,
};

const MAX_MEMBERS_BY_TIER: Record<CommercialTier, number | null> = {
  freemium: 1,
  starter: 4,
  pro: 10,
  enterprise: null,
  custom: null,
};

// Un rôle absent de cette table est disponible dès Freemium (rôles de base +
// conformité, §2.1). business_manager n'y figure pas volontairement : ce n'est
// pas un OrganizationRole dans ce repo (c'est un Mandate.grantedRole, jamais
// assignable via inviteMember()).
const MIN_TIER_FOR_ROLE: Partial<Record<OrganizationRole, CommercialTier>> = {
  inventory_manager: "starter",
  approver: "pro",
  auditor: "pro",
  developer_api: "pro",
};

export const ADVANCED_CUSTOMER_MANAGEMENT_MIN_TIER: CommercialTier = "pro";

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
