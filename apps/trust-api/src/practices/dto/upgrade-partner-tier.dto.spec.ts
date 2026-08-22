import { describe, expect, it } from "vitest";
import { upgradePartnerTierSchema } from "./upgrade-partner-tier.dto";

describe("upgradePartnerTierSchema (H3, ADR-071)", () => {
  it("accepte les 4 paliers de ProfessionalPracticeTier", () => {
    for (const tier of ["partner_free", "partner_starter", "partner_pro", "partner_institutional"]) {
      expect(upgradePartnerTierSchema.safeParse({ tier }).success).toBe(true);
    }
  });

  it("rejette un palier inconnu", () => {
    expect(upgradePartnerTierSchema.safeParse({ tier: "partner_ultra" }).success).toBe(false);
  });

  it("rejette une demande sans tier", () => {
    expect(upgradePartnerTierSchema.safeParse({}).success).toBe(false);
  });
});
