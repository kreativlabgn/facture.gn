import { describe, expect, it } from "vitest";
import { upgradeRevenueShareSettlementModeSchema } from "./upgrade-revenue-share-settlement-mode.dto";

describe("upgradeRevenueShareSettlementModeSchema (H3, ADR-071)", () => {
  it("accepte payout et subscription_deduction", () => {
    expect(upgradeRevenueShareSettlementModeSchema.safeParse({ mode: "payout" }).success).toBe(true);
    expect(upgradeRevenueShareSettlementModeSchema.safeParse({ mode: "subscription_deduction" }).success).toBe(true);
  });

  it("rejette une valeur inconnue", () => {
    expect(upgradeRevenueShareSettlementModeSchema.safeParse({ mode: "bank_transfer" }).success).toBe(false);
  });

  it("rejette une demande sans mode", () => {
    expect(upgradeRevenueShareSettlementModeSchema.safeParse({}).success).toBe(false);
  });
});
