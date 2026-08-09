import { SetMetadata } from "@nestjs/common";

export const ORGANIZATION_ID_SOURCE_KEY = "organizationIdSource";

// RolesGuard résout params.id comme un ID de FACTURE par défaut (issue/void/...) —
// ce décorateur bascule explicitement vers une résolution directe (params.id EST
// déjà l'ID de l'organisation), pour les routes scopées directement à une
// organisation plutôt qu'à une facture qui lui appartient (E8, trust-score).
export const OrganizationIdSource = (source: "invoice" | "organization") =>
  SetMetadata(ORGANIZATION_ID_SOURCE_KEY, source);
