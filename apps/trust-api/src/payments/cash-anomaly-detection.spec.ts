import { describe, expect, it } from "vitest";
import { detectCashAnomalyPatterns } from "./cash-anomaly-detection";

describe("detectCashAnomalyPatterns (G1, ADR-032)", () => {
  it("signale un montant rond au-delà du seuil de preuve (1M GNF, multiple exact de 100 000 GNF)", () => {
    const patterns = detectCashAnomalyPatterns({ amount: 150_000_000n, sameAmountRecentCount: 1 });

    expect(patterns).toEqual(["round_amount"]);
  });

  it("ignore un montant rond en dessous du seuil de preuve — normalité du commerce, pas un signal", () => {
    const patterns = detectCashAnomalyPatterns({ amount: 50_000_000n, sameAmountRecentCount: 1 });

    expect(patterns).toEqual([]);
  });

  it("ignore un montant non-rond au-dessus du seuil de preuve", () => {
    const patterns = detectCashAnomalyPatterns({ amount: 123_456_789n, sameAmountRecentCount: 1 });

    expect(patterns).toEqual([]);
  });

  it("signale une boucle client/montant à partir de 3 occurrences identiques, et cumule avec round_amount si applicable", () => {
    const boucleSeule = detectCashAnomalyPatterns({ amount: 123_456_789n, sameAmountRecentCount: 3 });
    const deuxPatterns = detectCashAnomalyPatterns({ amount: 150_000_000n, sameAmountRecentCount: 3 });

    expect(boucleSeule).toEqual(["client_amount_loop"]);
    expect(deuxPatterns).toEqual(["round_amount", "client_amount_loop"]);
  });
});
