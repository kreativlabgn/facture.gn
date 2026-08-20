import { describe, expect, it } from "vitest";
import { upgradeCommercialTierSchema } from "./upgrade-commercial-tier.dto";

describe("upgradeCommercialTierSchema (H2, ADR-049)", () => {
  it("accepte les 5 paliers connus de CommercialTier", () => {
    for (const tier of ["freemium", "starter", "pro", "enterprise", "custom"]) {
      const result = upgradeCommercialTierSchema.safeParse({ tier });
      expect(result.success).toBe(true);
    }
  });

  it("rejette un palier inconnu (ex: 'starter_plus', absent du schéma actuel)", () => {
    const result = upgradeCommercialTierSchema.safeParse({ tier: "starter_plus" });
    expect(result.success).toBe(false);
  });

  it("rejette une demande sans tier", () => {
    const result = upgradeCommercialTierSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
