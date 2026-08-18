import { describe, expect, it } from "vitest";
import { inviteOrganizationMemberSchema } from "./invite-organization-member.dto";

describe("inviteOrganizationMemberSchema", () => {
  it("accepte un msisdn valide et role tax_controller_readonly", () => {
    const result = inviteOrganizationMemberSchema.safeParse({
      msisdn: "+224612345678",
      role: "tax_controller_readonly",
    });

    expect(result.success).toBe(true);
  });

  it("rejette role owner — élévation de privilège hors périmètre de cette story", () => {
    const result = inviteOrganizationMemberSchema.safeParse({ msisdn: "+224612345678", role: "owner" });

    expect(result.success).toBe(false);
  });

  it("rejette un msisdn mal formé (pas +224 E.164)", () => {
    const result = inviteOrganizationMemberSchema.safeParse({ msisdn: "0612345678", role: "tax_controller_readonly" });

    expect(result.success).toBe(false);
  });

  it("rejette une demande sans role", () => {
    const result = inviteOrganizationMemberSchema.safeParse({ msisdn: "+224612345678" });

    expect(result.success).toBe(false);
  });
});
