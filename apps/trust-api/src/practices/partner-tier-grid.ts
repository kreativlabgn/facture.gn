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

// ── Plafond d'organisations mandatées, par palier (ADR-071, Grille-Offres) ──
//
// LA GRILLE NE PORTAIT QUE DES PRIX. Free, Starter et Pro se distinguent aussi
// par le nombre d'entreprises qu'un cabinet peut suivre — et rien ne
// l'appliquait : un partenaire Free pouvait mandater deux cents PME sans
// jamais payer. Ce n'est pas seulement un manque à gagner, c'est la règle de
// gestion elle-même qui n'était pas tenue.
//
// `null` = illimité, et c'est une valeur SIGNIFIANTE, pas une absence : Pro et
// Institutionnel sont illimités par contrat. Un Number.MAX_SAFE_INTEGER aurait
// fait passer une décision commerciale pour un détail d'implémentation.
const PARTNER_TIER_MAX_ORGANIZATIONS: Record<ProfessionalPracticeTier, number | null> = {
  partner_free: 5,
  partner_starter: 50,
  partner_pro: null,
  partner_institutional: null,
};

export function getPartnerTierMaxOrganizations(tier: ProfessionalPracticeTier): number | null {
  return PARTNER_TIER_MAX_ORGANIZATIONS[tier];
}

/** Vrai si le palier permet d'atteindre `total` organisations mandatées.
 *  Sert dans les deux sens : refuser un mandat de trop, et refuser une
 *  rétrogradation qui laisserait le cabinet au-dessus de son propre plafond. */
export function tierAccepteOrganisations(tier: ProfessionalPracticeTier, total: number): boolean {
  const plafond = PARTNER_TIER_MAX_ORGANIZATIONS[tier];
  return plafond === null || total <= plafond;
}
