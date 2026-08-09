import { SetMetadata } from "@nestjs/common";

export const ORGANIZATION_ID_SOURCE_KEY = "organizationIdSource";

// RolesGuard résout params.id comme un ID de FACTURE par défaut (issue/void/...) —
// ce décorateur bascule explicitement vers une résolution directe, pour les routes
// scopées à une organisation (E8, trust-score) ou à un avoir (C13, refunds) plutôt
// qu'à une facture qui lui appartient.
export const OrganizationIdSource = (source: "invoice" | "organization" | "credit-note") =>
  SetMetadata(ORGANIZATION_ID_SOURCE_KEY, source);
