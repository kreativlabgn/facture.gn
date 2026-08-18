import { describe, expect, it } from "vitest";
import { proposeCreditLimitSchema } from "./propose-credit-limit.dto";

describe("proposeCreditLimitSchema", () => {
  it("accepte un newLimit positif", () => {
    const result = proposeCreditLimitSchema.safeParse({ newLimit: 5_000_000 });
    expect(result.success).toBe(true);
  });

  it("rejette un newLimit négatif", () => {
    const result = proposeCreditLimitSchema.safeParse({ newLimit: -1 });
    expect(result.success).toBe(false);
  });

  it("coerce une string numérique en bigint", () => {
    const result = proposeCreditLimitSchema.safeParse({ newLimit: "5000000" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.newLimit).toBe(5_000_000n);
    }
  });
});
