import { describe, expect, it } from "vitest";
import { setCostPriceSchema } from "./set-cost-price.dto";

describe("setCostPriceSchema", () => {
  it("accepte un costPrice positif", () => {
    const result = setCostPriceSchema.safeParse({ costPrice: 15_000 });
    expect(result.success).toBe(true);
  });

  it("accepte un costPrice à zéro", () => {
    const result = setCostPriceSchema.safeParse({ costPrice: 0 });
    expect(result.success).toBe(true);
  });

  it("rejette un costPrice négatif", () => {
    const result = setCostPriceSchema.safeParse({ costPrice: -1 });
    expect(result.success).toBe(false);
  });

  it("coerce une string numérique en bigint", () => {
    const result = setCostPriceSchema.safeParse({ costPrice: "15000" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.costPrice).toBe(15_000n);
    }
  });
});
