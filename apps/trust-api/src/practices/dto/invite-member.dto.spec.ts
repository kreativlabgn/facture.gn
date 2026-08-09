import { describe, expect, it } from "vitest";
import { inviteMemberSchema } from "./invite-member.dto";

describe("inviteMemberSchema", () => {
  it("accepte un msisdn valide et role accountant_external", () => {
    const result = inviteMemberSchema.safeParse({ msisdn: "+224612345678", role: "accountant_external" });

    expect(result.success).toBe(true);
  });

  it("rejette role business_manager — hors scope MVP (ADR-070, V1)", () => {
    const result = inviteMemberSchema.safeParse({ msisdn: "+224612345678", role: "business_manager" });

    expect(result.success).toBe(false);
  });

  it("rejette un msisdn mal formé (pas +224 E.164)", () => {
    const result = inviteMemberSchema.safeParse({ msisdn: "0612345678", role: "accountant_external" });

    expect(result.success).toBe(false);
  });

  it("rejette une demande sans role", () => {
    const result = inviteMemberSchema.safeParse({ msisdn: "+224612345678" });

    expect(result.success).toBe(false);
  });
});
