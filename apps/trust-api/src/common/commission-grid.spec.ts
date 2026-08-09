import { describe, expect, it } from "vitest";
import { computePlatformFee } from "./commission-grid";

describe("computePlatformFee — grille 5 paliers (ADR-074)", () => {
  it("applique 2,5% pour freemium", () => {
    expect(computePlatformFee(2_000_000n, "freemium")).toBe(50_000n);
  });

  it("applique 2,0% pour starter", () => {
    expect(computePlatformFee(2_000_000n, "starter")).toBe(40_000n);
  });

  it("applique 1,5% pour pro", () => {
    expect(computePlatformFee(2_000_000n, "pro")).toBe(30_000n);
  });

  it("applique 1,2% pour enterprise", () => {
    expect(computePlatformFee(2_000_000n, "enterprise")).toBe(24_000n);
  });

  it("applique 1,0% pour custom", () => {
    expect(computePlatformFee(2_000_000n, "custom")).toBe(20_000n);
  });

  it("plafonne à 5 000 000 centimes (50 000 GNF) pour freemium au-delà du seuil", () => {
    // 2,5% de 1 000 000 000 centimes (10M GNF) = 25 000 000 centimes — largement
    // au-dessus du cap freemium (5 000 000 centimes = 50 000 GNF).
    expect(computePlatformFee(1_000_000_000n, "freemium")).toBe(5_000_000n);
  });

  it("plafonne à 7 500 000 centimes (75 000 GNF) pour pro au-delà du seuil", () => {
    expect(computePlatformFee(1_000_000_000n, "pro")).toBe(7_500_000n);
  });

  it("plafonne à 15 000 000 centimes (150 000 GNF) pour custom au-delà du seuil", () => {
    // 1% de 2 000 000 000 centimes (20M GNF) = 20 000 000 centimes — au-dessus du
    // cap custom (15 000 000 centimes = 150 000 GNF).
    expect(computePlatformFee(2_000_000_000n, "custom")).toBe(15_000_000n);
  });
});
