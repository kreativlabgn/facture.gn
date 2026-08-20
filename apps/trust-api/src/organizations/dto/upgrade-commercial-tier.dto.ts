import { z } from "zod";

// H2, ADR-049 — "palier commercial gouverne l'accès aux fonctionnalités,
// jamais dépendant de DGI". z.enum plutôt que z.nativeEnum(CommercialTier) :
// même convention que les autres DTO de ce repo (aucun z.nativeEnum ailleurs),
// littéraux tenus à jour manuellement en cas d'ajout de palier au schéma.
export const upgradeCommercialTierSchema = z.object({
  tier: z.enum(["freemium", "starter", "pro", "enterprise", "custom"]),
});

export type UpgradeCommercialTierDto = z.infer<typeof upgradeCommercialTierSchema>;
