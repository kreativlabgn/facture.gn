import { SetMetadata } from "@nestjs/common";

export const ORGANIZATION_ID_SOURCE_KEY = "organizationIdSource";

// RolesGuard résout params.id comme un ID de FACTURE par défaut (issue/void/...) —
// ce décorateur bascule explicitement vers une résolution directe, pour les routes
// scopées à une organisation (E8, trust-score), un avoir (C13, refunds), un
// client (C6, running balance), une succursale (E1, revenue), une demande de
// hausse de limite de crédit (E5, ADR-083), un produit (E6, ADR-084) ou un
// modèle de facture récurrente (I1, ADR-056) plutôt qu'à une facture qui lui
// appartient.
export const OrganizationIdSource = (
  source:
    | "invoice"
    | "organization"
    | "credit-note"
    | "customer"
    | "branch"
    | "credit-limit-request"
    | "product"
    | "recurring-template",
) => SetMetadata(ORGANIZATION_ID_SOURCE_KEY, source);
