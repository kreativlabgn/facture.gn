import { describe, expect, it } from "vitest";
import { detectCashAnomalyPatterns } from "./cash-anomaly-detection";

const DEFAULT_THRESHOLD = 100_000_000n;

describe("detectCashAnomalyPatterns (G1, ADR-032 + G3, ADR-091)", () => {
  it("signale un montant rond au-delà du seuil effectif (1M GNF, multiple exact de 100 000 GNF)", () => {
    const patterns = detectCashAnomalyPatterns({
      amount: 150_000_000n,
      sameAmountRecentCount: 1,
      effectiveProofThreshold: DEFAULT_THRESHOLD,
      sameOrgSubThresholdRecentCount: 0,
    });

    expect(patterns).toEqual(["round_amount"]);
  });

  it("ignore un montant rond en dessous du seuil effectif — normalité du commerce, pas un signal", () => {
    const patterns = detectCashAnomalyPatterns({
      amount: 50_000_000n,
      sameAmountRecentCount: 1,
      effectiveProofThreshold: DEFAULT_THRESHOLD,
      sameOrgSubThresholdRecentCount: 0,
    });

    expect(patterns).toEqual([]);
  });

  it("ignore un montant non-rond au-dessus du seuil effectif", () => {
    const patterns = detectCashAnomalyPatterns({
      amount: 123_456_789n,
      sameAmountRecentCount: 1,
      effectiveProofThreshold: DEFAULT_THRESHOLD,
      sameOrgSubThresholdRecentCount: 0,
    });

    expect(patterns).toEqual([]);
  });

  it("signale une boucle client/montant à partir de 3 occurrences identiques, et cumule avec round_amount si applicable", () => {
    const boucleSeule = detectCashAnomalyPatterns({
      amount: 123_456_789n,
      sameAmountRecentCount: 3,
      effectiveProofThreshold: DEFAULT_THRESHOLD,
      sameOrgSubThresholdRecentCount: 0,
    });
    const deuxPatterns = detectCashAnomalyPatterns({
      amount: 150_000_000n,
      sameAmountRecentCount: 3,
      effectiveProofThreshold: DEFAULT_THRESHOLD,
      sameOrgSubThresholdRecentCount: 0,
    });

    expect(boucleSeule).toEqual(["client_amount_loop"]);
    expect(deuxPatterns).toEqual(["round_amount", "client_amount_loop"]);
  });

  describe("sub_threshold_recurrence (G3, ADR-091 — récurrence de montants juste sous le seuil de preuve)", () => {
    it("signale un montant dans la bande des 10% sous le seuil effectif, récurrent au moins 3 fois", () => {
      const patterns = detectCashAnomalyPatterns({
        amount: 95_000_000n, // dans [90M, 100M) pour un seuil à 100M
        sameAmountRecentCount: 1,
        effectiveProofThreshold: DEFAULT_THRESHOLD,
        sameOrgSubThresholdRecentCount: 3,
      });

      expect(patterns).toEqual(["sub_threshold_recurrence"]);
    });

    it("ignore un montant dans la bande sous le seuil si la récurrence n'atteint pas 3", () => {
      const patterns = detectCashAnomalyPatterns({
        amount: 95_000_000n,
        sameAmountRecentCount: 1,
        effectiveProofThreshold: DEFAULT_THRESHOLD,
        sameOrgSubThresholdRecentCount: 2,
      });

      expect(patterns).toEqual([]);
    });

    it("ignore un montant récurrent mais hors de la bande des 10% sous le seuil", () => {
      const patterns = detectCashAnomalyPatterns({
        amount: 50_000_000n,
        sameAmountRecentCount: 1,
        effectiveProofThreshold: DEFAULT_THRESHOLD,
        sameOrgSubThresholdRecentCount: 5,
      });

      expect(patterns).toEqual([]);
    });

    it("suit le seuil effectif abaissé (Niveau 2, ADR-091) — la bande se déplace avec le seuil", () => {
      const patterns = detectCashAnomalyPatterns({
        amount: 48_000_000n, // dans [45M, 50M) pour un seuil abaissé à 50M
        sameAmountRecentCount: 1,
        effectiveProofThreshold: 50_000_000n,
        sameOrgSubThresholdRecentCount: 3,
      });

      expect(patterns).toEqual(["sub_threshold_recurrence"]);
    });

    it("cumule avec round_amount et client_amount_loop si tous les critères sont réunis", () => {
      const patterns = detectCashAnomalyPatterns({
        amount: 150_000_000n,
        sameAmountRecentCount: 3,
        effectiveProofThreshold: DEFAULT_THRESHOLD,
        sameOrgSubThresholdRecentCount: 3,
      });

      // 150M est rond et au-delà du seuil, mais PAS dans la bande sous le seuil
      // (>= effectiveProofThreshold, jamais < lui) — sub_threshold_recurrence ne
      // peut structurellement jamais cumuler avec round_amount pour le même montant.
      expect(patterns).toEqual(["round_amount", "client_amount_loop"]);
    });
  });
});
