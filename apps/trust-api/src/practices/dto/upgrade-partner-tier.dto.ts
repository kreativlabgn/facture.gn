import { z } from "zod";

// H3, ADR-071 — partner_institutional accepté sans restriction, même précédent
// que CommercialTier.custom sur upgradeCommercialTierSchema (H2) : "custom"
// est déjà un palier négocié là aussi, jamais bloqué à l'auto-attribution.
export const upgradePartnerTierSchema = z.object({
  tier: z.enum(["partner_free", "partner_starter", "partner_pro", "partner_institutional"]),
});

export type UpgradePartnerTierDto = z.infer<typeof upgradePartnerTierSchema>;
