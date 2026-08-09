import type { CommercialTier } from "@facture-gn/db";

// Grille tarifaire à 5 paliers (ADR-074, en vigueur depuis le 26/07) — jamais un
// input client. ADR-058 demande une table de config versionnée pour ce type de
// donnée, mais CONFIG_PARAMETER n'a jamais été scaffoldée dans ce repo ; même
// choix déjà accepté que tax-regime.ts (C4) pour les taux de TVA — codé en
// constante, pas de nouvelle infrastructure de config pour cette story.
// "Commission cible (négo)" (taux plancher négociable au cas par cas, jamais
// public) est explicitement hors scope — aucun champ scaffoldé pour un taux par
// organisation, seule la commission affichée (par défaut) est implémentée ici.
//
// Correction du frais gateway Djomy (ADR-072 "annoncé 1%, à confirmer" → réel
// 1,4%, voir djomy-stub.provider.ts) : freemium réduit sa propre commission de
// 2,5% à 2,1% (décision produit : 2,5% - (1,4% - 1,0%)) pour viser un total
// payeur de 3,5%. Les autres paliers gardent leur marge inchangée — le total
// payeur augmente simplement du vrai 1,4% gateway (starter 3,4%, pro 2,9%,
// enterprise 2,6%, custom 2,4%), jamais recalculé pour absorber quoi que ce soit.
//
// Écart mesuré (E2E réel) et sciemment accepté : le total payeur freemium
// atteint en réalité 3,5294%, pas exactement 3,5% — le gateway Djomy calcule
// son 1,4% sur le montant DÉJÀ majoré par notre commission (effet de cascade,
// amountGnf transmis à money-api = amountDue + platformFee), pas sur le montant
// brut de la facture. Un taux exact de ~2,071% annulerait cet effet
// (p + g + p×g = 3,5%), mais l'écart réel (~0,03 point, quelques GNF par
// transaction) a été jugé négligeable — 2,1% (soustraction simple) conservé.
const COMMISSION_BPS_BY_TIER: Record<CommercialTier, number> = {
  freemium: 210,
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
