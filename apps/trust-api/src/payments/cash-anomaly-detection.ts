// Multiple exact de 100 000 GNF (centimes) — "montant rond" au sens ADR-032. Seuil
// plancher = effectiveProofThreshold (même précédent de seuil en dur MVP que la
// preuve photo/GPS/signature) : un petit montant rond (ex. 5 000 GNF) est la
// normalité du commerce, pas un signal.
const ROUND_AMOUNT_UNIT_CENTIMES = 10_000_000n;

// ADR-032 ne fixe aucun chiffre — 3 occurrences/24h est un choix MVP documenté ici,
// pas un blocage produit puisque ADR-032 exige une revue humaine, jamais un rejet
// automatique : le coût d'un faux positif reste faible.
const STRUCTURING_LOOP_MIN_OCCURRENCES = 3;

// G3, ADR-091 — "juste sous" le seuil de preuve = dans les 10% en dessous du seuil
// effectif, arbitraire MVP documenté ici (même posture que STRUCTURING_LOOP_MIN_OCCURRENCES
// ci-dessus). Récurrence org-wide (pas par client, contrairement à sameAmountRecentCount) :
// voir non-cash-ratio-drop.ts et PaymentsService.computeSubThresholdRecurrence().
const SUB_THRESHOLD_BAND_RATIO_PERCENT = 10n;
const SUB_THRESHOLD_RECURRENCE_MIN_OCCURRENCES = 3;

export type CashAnomalyPattern = "round_amount" | "client_amount_loop" | "sub_threshold_recurrence";

// G3, ADR-091 — découplé du DTO : le seuil n'est plus une constante globale
// importée mais un paramètre fourni par l'appelant (PaymentsService, qui résout
// l'override par organisation, Niveau 2). round_amount suit donc lui aussi
// désormais le seuil abaissé, jamais figé sur la constante globale.
export function detectCashAnomalyPatterns(params: {
  amount: bigint;
  sameAmountRecentCount: number;
  effectiveProofThreshold: bigint;
  sameOrgSubThresholdRecentCount: number;
}): CashAnomalyPattern[] {
  const patterns: CashAnomalyPattern[] = [];

  if (
    params.amount >= params.effectiveProofThreshold &&
    params.amount % ROUND_AMOUNT_UNIT_CENTIMES === 0n
  ) {
    patterns.push("round_amount");
  }

  if (params.sameAmountRecentCount >= STRUCTURING_LOOP_MIN_OCCURRENCES) {
    patterns.push("client_amount_loop");
  }

  const band = (params.effectiveProofThreshold * SUB_THRESHOLD_BAND_RATIO_PERCENT) / 100n;
  const bandFloor = params.effectiveProofThreshold - band;
  if (
    params.amount >= bandFloor &&
    params.amount < params.effectiveProofThreshold &&
    params.sameOrgSubThresholdRecentCount >= SUB_THRESHOLD_RECURRENCE_MIN_OCCURRENCES
  ) {
    patterns.push("sub_threshold_recurrence");
  }

  return patterns;
}
