import { describe, expect, it } from "vitest";
import { getPartnerTierPrice } from "./partner-tier-grid";

describe("getPartnerTierPrice (H3, ADR-071, Grille-Offres §5.1)", () => {
  it("partner_free = 0 GNF, fixe", () => {
    expect(getPartnerTierPrice("partner_free")).toEqual({ kind: "fixed", amountCentimes: 0n });
  });

  it("partner_starter = 500 000 GNF, fixe", () => {
    expect(getPartnerTierPrice("partner_starter")).toEqual({ kind: "fixed", amountCentimes: 50_000_000n });
  });

  it("partner_pro = 1 500 000 GNF, fixe", () => {
    expect(getPartnerTierPrice("partner_pro")).toEqual({ kind: "fixed", amountCentimes: 150_000_000n });
  });

  it("partner_institutional = sur devis, jamais un montant inventé", () => {
    expect(getPartnerTierPrice("partner_institutional")).toEqual({ kind: "quote_required" });
  });
});
