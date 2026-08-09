import { describe, expect, it } from "vitest";
import { resolveTaxRateBps } from "./tax-regime";

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
