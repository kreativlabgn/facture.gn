import type { ProfessionalPracticeTier } from "@facture-gn/db";

// H3, ADR-071, Grille-Offres §5.1 — grille hardcodée, même pattern que
// commission-grid.ts/tax-regime.ts/revenue-share-grid.ts (ADR-058 jamais
// scaffoldée dans ce repo). partner_institutional est explicitement "sur
// devis" : jamais un prix fixe inventé (0 ou arbitraire) — amountCentimes
// n'existe même pas dans ce cas, structurellement irreprésentable.
export type PartnerTierPrice = { kind: "fixed"; amountCentimes: bigint } | { kind: "quote_required" };

const PARTNER_TIER_MONTHLY_PRICE_CENTIMES_GNF: Record<
  Exclude<ProfessionalPracticeTier, "partner_institutional">,
  bigint
> = {
  partner_free: 0n,
  partner_starter: 50_000_000n,
  partner_pro: 150_000_000n,
};

export function getPartnerTierPrice(tier: ProfessionalPracticeTier): PartnerTierPrice {
  if (tier === "partner_institutional") {
    return { kind: "quote_required" };
  }
  return { kind: "fixed", amountCentimes: PARTNER_TIER_MONTHLY_PRICE_CENTIMES_GNF[tier] };
}
