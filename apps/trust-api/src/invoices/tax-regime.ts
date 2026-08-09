import type { RegimeFiscal } from "@facture-gn/db";

// Seule source de vérité pour le taux de TVA d'une facture — jamais un input
// client (C4, ADR-033 "jamais un taux TVA plat"). Taux exacts : DAT §12.
// tpu est un impôt forfaitaire de 5% sur le chiffre d'affaires déclaré, payé
// séparément par l'organisation — jamais une TVA collectée sur la facture,
// donc 0 bps ici. non_assujetti_association est exonérée par nature ; le
// mécanisme d'exemption détaillé (I4) est hors MVP, mais 0% reste le défaut
// le plus sûr pour une entité qui ne doit structurellement jamais facturer de TVA.
const TAX_RATE_BPS_BY_REGIME: Record<RegimeFiscal, number> = {
  normal_tva: 1800,
  tpu: 0,
  normal_sans_tva: 0,
  non_assujetti_association: 0,
};

export function resolveTaxRateBps(regimeFiscal: RegimeFiscal): number {
  return TAX_RATE_BPS_BY_REGIME[regimeFiscal];
}

const BPS_DENOMINATOR = 10_000n;

// Unique point de calcul HT/TVA depuis un TTC (convention TTC-first, C4) — appelé à
// la fois par createDraft() et convertToInvoice() (C15). totalTva est TOUJOURS
// dérivé par soustraction, jamais recalculé indépendamment : deux formules
// distinctes sous arrondi bigint pourraient diverger d'une unité GNF et casser
// l'invariant totalHt+totalTva=totalTtc (protégé aussi par une contrainte CHECK SQL,
// mais ce n'est pas le seul garde-fou attendu).
export function computeTaxBreakdown(totalTtc: bigint, taxRateBps: number): { totalHt: bigint; totalTva: bigint } {
  const totalHt = (totalTtc * BPS_DENOMINATOR) / (BPS_DENOMINATOR + BigInt(taxRateBps));
  const totalTva = totalTtc - totalHt;
  return { totalHt, totalTva };
}
