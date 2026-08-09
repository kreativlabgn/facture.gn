import { describe, expect, it } from "vitest";
import { computeTaxBreakdown, resolveTaxRateBps } from "./tax-regime";

describe("resolveTaxRateBps — dérivation du taux de TVA depuis le régime fiscal (C4, ADR-033)", () => {
  it("applique 18% (1800 bps) pour normal_tva — DAT §12", () => {
    expect(resolveTaxRateBps("normal_tva")).toBe(1800);
  });

  it("applique 0% pour tpu — impôt forfaitaire sur le CA, jamais une TVA collectée sur facture", () => {
    expect(resolveTaxRateBps("tpu")).toBe(0);
  });

  it("applique 0% pour normal_sans_tva", () => {
    expect(resolveTaxRateBps("normal_sans_tva")).toBe(0);
  });

  it("applique 0% pour non_assujetti_association — exonéré par nature", () => {
    expect(resolveTaxRateBps("non_assujetti_association")).toBe(0);
  });
});

describe("computeTaxBreakdown — point de calcul unique HT/TVA (C4/C15)", () => {
  it("calcule totalHt/totalTva à 18% et garantit totalHt+totalTva=totalTtc", () => {
    const { totalHt, totalTva } = computeTaxBreakdown(1_180_000n, 1800);

    expect(totalHt).toBe(1_000_000n);
    expect(totalTva).toBe(180_000n);
    expect(totalHt + totalTva).toBe(1_180_000n);
  });

  it("retourne totalTva=0 et totalHt=totalTtc à 0%", () => {
    const { totalHt, totalTva } = computeTaxBreakdown(350_000n, 0);

    expect(totalTva).toBe(0n);
    expect(totalHt).toBe(350_000n);
  });

  it("garantit totalHt+totalTva=totalTtc même sur un montant qui ne se divise pas exactement (arrondi bigint)", () => {
    const { totalHt, totalTva } = computeTaxBreakdown(1_000_000n, 1800);

    expect(totalHt + totalTva).toBe(1_000_000n);
  });
});
