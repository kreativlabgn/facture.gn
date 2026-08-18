import { describe, expect, it } from "vitest";
import { resolveCreditLimitRequestSchema } from "./resolve-credit-limit-request.dto";

describe("resolveCreditLimitRequestSchema", () => {
  it("accepte decision=approved", () => {
    const result = resolveCreditLimitRequestSchema.safeParse({ decision: "approved" });
    expect(result.success).toBe(true);
  });

  it("accepte decision=rejected", () => {
    const result = resolveCreditLimitRequestSchema.safeParse({ decision: "rejected" });
    expect(result.success).toBe(true);
  });

  it("rejette une decision hors énumération", () => {
    const result = resolveCreditLimitRequestSchema.safeParse({ decision: "maybe" });
    expect(result.success).toBe(false);
  });
});
