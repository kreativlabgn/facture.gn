import { describe, expect, it } from "vitest";
import { chooseFinancingSchema } from "./choose-financing.dto";

describe("chooseFinancingSchema", () => {
  it("accepte payment_link_payout avec un financialPartnerId uuid valide", () => {
    const result = chooseFinancingSchema.safeParse({
      financialPartnerId: "11111111-1111-4111-8111-111111111111",
      disbursementMethod: "payment_link_payout",
    });
    expect(result.success).toBe(true);
  });

  it("accepte bank_transfer", () => {
    const result = chooseFinancingSchema.safeParse({
      financialPartnerId: "11111111-1111-4111-8111-111111111111",
      disbursementMethod: "bank_transfer",
    });
    expect(result.success).toBe(true);
  });

  it("rejette un disbursementMethod hors énumération", () => {
    const result = chooseFinancingSchema.safeParse({
      financialPartnerId: "11111111-1111-4111-8111-111111111111",
      disbursementMethod: "cash",
    });
    expect(result.success).toBe(false);
  });

  it("rejette un financialPartnerId mal formé", () => {
    const result = chooseFinancingSchema.safeParse({
      financialPartnerId: "pas-un-uuid",
      disbursementMethod: "bank_transfer",
    });
    expect(result.success).toBe(false);
  });
});
