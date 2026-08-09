import type { CommercialTier } from "@facture-gn/db";

// Grille tarifaire à 5 paliers (ADR-074, en vigueur depuis le 26/07) — jamais un
// input client. ADR-058 demande une table de config versionnée pour ce type de
// donnée, mais CONFIG_PARAMETER n'a jamais été scaffoldée dans ce repo ; même
// choix déjà accepté que tax-regime.ts (C4) pour les taux de TVA — codé en
// constante, pas de nouvelle infrastructure de config pour cette story.
// "Commission cible (négo)" (taux plancher négociable au cas par cas, jamais
// public) est explicitement hors scope — aucun champ scaffoldé pour un taux par
// organisation, seule la commission affichée (par défaut) est implémentée ici.
const COMMISSION_BPS_BY_TIER: Record<CommercialTier, number> = {
  freemium: 250,
  starter: 200,
  pro: 150,
  enterprise: 120,
  custom: 100,
};

// Centimes GNF (100 centimes = 1 GNF, DAT) — 50 000/50 000/75 000/100 000/150 000
// GNF selon le palier.
const COMMISSION_CAP_CENTIMES_BY_TIER: Record<CommercialTier, bigint> = {
  freemium: 5_000_000n,
  starter: 5_000_000n,
  pro: 7_500_000n,
  enterprise: 10_000_000n,
  custom: 15_000_000n,
};

const BPS_DENOMINATOR = 10_000n;

// Portée : uniquement les encaissements via lien de paiement (Mobile Money/carte,
// method: payment_link) — jamais cash (0% systématique, grille) ni bank_transfer
// (C3/ADR-052, jamais couvert par ADR-074).
export function computePlatformFee(amountGnf: bigint, tier: CommercialTier): bigint {
  const raw = (amountGnf * BigInt(COMMISSION_BPS_BY_TIER[tier])) / BPS_DENOMINATOR;
  const cap = COMMISSION_CAP_CENTIMES_BY_TIER[tier];
  return raw > cap ? cap : raw;
}
