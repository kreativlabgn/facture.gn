import { describe, expect, it } from "vitest";
import { invitePracticePendingSchema } from "./invite-practice-pending.dto";

describe("invitePracticePendingSchema", () => {
  it("accepte un msisdn valide et role accountant_external", () => {
    const result = invitePracticePendingSchema.safeParse({ msisdn: "+224612345678", role: "accountant_external" });

    expect(result.success).toBe(true);
  });

  it("rejette role business_manager — reste V1, hors MVP (ADR-070)", () => {
    const result = invitePracticePendingSchema.safeParse({ msisdn: "+224612345678", role: "business_manager" });

    expect(result.success).toBe(false);
  });

  it("rejette role practice_admin — jamais assignable par invitation", () => {
    const result = invitePracticePendingSchema.safeParse({ msisdn: "+224612345678", role: "practice_admin" });

    expect(result.success).toBe(false);
  });

  it("rejette un msisdn mal formé (pas +224 E.164)", () => {
    const result = invitePracticePendingSchema.safeParse({ msisdn: "0612345678", role: "accountant_external" });

    expect(result.success).toBe(false);
  });
});
