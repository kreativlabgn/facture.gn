import { CASH_PROOF_THRESHOLD_GNF_CENTIMES } from "./dto/create-payment.dto";

// Multiple exact de 100 000 GNF (centimes) — "montant rond" au sens ADR-032. Seuil
// plancher = CASH_PROOF_THRESHOLD_GNF_CENTIMES (même précédent de seuil en dur MVP
// que la preuve photo/GPS/signature) : un petit montant rond (ex. 5 000 GNF) est la
// normalité du commerce, pas un signal.
const ROUND_AMOUNT_UNIT_CENTIMES = 10_000_000n;

// ADR-032 ne fixe aucun chiffre — 3 occurrences/24h est un choix MVP documenté ici,
// pas un blocage produit puisque ADR-032 exige une revue humaine, jamais un rejet
// automatique : le coût d'un faux positif reste faible.
const STRUCTURING_LOOP_MIN_OCCURRENCES = 3;

export type CashAnomalyPattern = "round_amount" | "client_amount_loop";

export function detectCashAnomalyPatterns(params: {
  amount: bigint;
  sameAmountRecentCount: number;
}): CashAnomalyPattern[] {
  const patterns: CashAnomalyPattern[] = [];

  if (params.amount >= CASH_PROOF_THRESHOLD_GNF_CENTIMES && params.amount % ROUND_AMOUNT_UNIT_CENTIMES === 0n) {
    patterns.push("round_amount");
  }

  if (params.sameAmountRecentCount >= STRUCTURING_LOOP_MIN_OCCURRENCES) {
    patterns.push("client_amount_loop");
  }

  return patterns;
}
