import { SetMetadata } from "@nestjs/common";

export const ORGANIZATION_ID_SOURCE_KEY = "organizationIdSource";

// Quality Audit 2026-08-23, finding #11 — source de vérité unique : cette union
// était redéclarée indépendamment 3 fois (ici + deux fois dans roles.guard.ts),
// sans lien entre les déclarations au niveau du compilateur. Un futur ajout de
// valeur ici sans la branche correspondante dans RolesGuard.resolveOrganizationId()
// compilait silencieusement, l'idSource inconnu tombant dans la branche "invoice"
// par défaut (fail-closed en pratique — 404 probable — mais un bug de résolution
// d'organisation totalement silencieux au build).
export type OrganizationIdSourceValue =
  | "invoice"
  | "organization"
  | "credit-note"
  | "customer"
  | "branch"
  | "credit-limit-request"
  | "product"
  | "recurring-template";

// RolesGuard résout params.id comme un ID de FACTURE par défaut (issue/void/...) —
// ce décorateur bascule explicitement vers une résolution directe, pour les routes
// scopées à une organisation (E8, trust-score), un avoir (C13, refunds), un
// client (C6, running balance), une succursale (E1, revenue), une demande de
// hausse de limite de crédit (E5, ADR-083), un produit (E6, ADR-084) ou un
// modèle de facture récurrente (I1, ADR-056) plutôt qu'à une facture qui lui
// appartient.
export const OrganizationIdSource = (source: OrganizationIdSourceValue) =>
  SetMetadata(ORGANIZATION_ID_SOURCE_KEY, source);
