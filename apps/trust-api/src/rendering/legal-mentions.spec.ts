import type { RegimeFiscal } from "@facture-gn/db";
import { describe, expect, it } from "vitest";
import { legalMentionsFor } from "./legal-mentions";

const ALL_REGIMES: RegimeFiscal[] = [
  "normal_tva",
  "tpu",
  "normal_sans_tva",
  "non_assujetti_association",
];

describe("legalMentionsFor — mentions legales OHADA par regime fiscal", () => {
  it("renvoie au moins une mention pour chaque regime (exhaustivite)", () => {
    for (const regime of ALL_REGIMES) {
      expect(legalMentionsFor(regime).length).toBeGreaterThan(0);
    }
  });

  it("normal_tva : mentionne le taux de TVA 18 % (derive de tax-regime, jamais invente)", () => {
    const mentions = legalMentionsFor("normal_tva").join(" ");
    expect(mentions).toMatch(/TVA/);
    expect(mentions).toContain("18");
  });

  it("normal_sans_tva : mentionne explicitement TVA non applicable", () => {
    expect(legalMentionsFor("normal_sans_tva").join(" ")).toMatch(/TVA non applicable/i);
  });

  it("non_assujetti_association : mentionne explicitement TVA non applicable", () => {
    expect(legalMentionsFor("non_assujetti_association").join(" ")).toMatch(/TVA non applicable/i);
  });

  it("tpu : mentionne le forfait, jamais un taux de TVA", () => {
    const mentions = legalMentionsFor("tpu").join(" ");
    expect(mentions).toMatch(/TPU|forfait/i);
    expect(mentions).not.toContain("18 %");
    expect(mentions).not.toMatch(/TVA au taux/i);
  });

  it("toute facture porte une mention de penalites de retard", () => {
    for (const regime of ALL_REGIMES) {
      expect(legalMentionsFor(regime).join(" ")).toMatch(/retard/i);
    }
  });
});
