// G3, ADR-091 — signal org-wide (jamais scopé à un seul client, contrairement à
// sameAmountRecentCount de cash-anomaly-detection.ts). Constantes MVP documentées
// comme arbitraires — calibrage réel différé aux données pilotes (même posture
// qu'ailleurs dans ce moteur).
export const NON_CASH_RATIO_CONVERTED_FLOOR = 0.4; // sous ce seuil, l'org n'a jamais été "convertie" — rien à faire chuter
export const NON_CASH_RATIO_DROP_THRESHOLD = 0.5; // chute relative d'au moins 50% du ratio antérieur
export const RATIO_WINDOW_DAYS = 30;

export function detectNonCashRatioDrop(params: { priorNonCashRatio: number; recentNonCashRatio: number }): boolean {
  if (params.priorNonCashRatio < NON_CASH_RATIO_CONVERTED_FLOOR) {
    return false;
  }

  const relativeDrop = (params.priorNonCashRatio - params.recentNonCashRatio) / params.priorNonCashRatio;
  return relativeDrop >= NON_CASH_RATIO_DROP_THRESHOLD;
}
