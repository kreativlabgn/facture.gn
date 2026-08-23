import { describe, expect, it } from "vitest";
import { inviteOrganizationPendingSchema } from "./invite-organization-pending.dto";

describe("inviteOrganizationPendingSchema", () => {
  it("accepte un msisdn valide et role cashier", () => {
    const result = inviteOrganizationPendingSchema.safeParse({ msisdn: "+224612345678", role: "cashier" });

    expect(result.success).toBe(true);
  });

  it("rejette role owner — jamais assignable par invitation", () => {
    const result = inviteOrganizationPendingSchema.safeParse({ msisdn: "+224612345678", role: "owner" });

    expect(result.success).toBe(false);
  });

  it("rejette role client_portal — identité auto-résolue (ADR-096), jamais un accès délégué invitable", () => {
    const result = inviteOrganizationPendingSchema.safeParse({ msisdn: "+224612345678", role: "client_portal" });

    expect(result.success).toBe(false);
  });

  it("accepte les rôles avancés du catalogue, même liste que inviteOrganizationMemberSchema (F14/H1)", () => {
    for (const role of ["inventory_manager", "approver", "auditor", "developer_api", "admin", "cashier", "viewer"]) {
      const result = inviteOrganizationPendingSchema.safeParse({ msisdn: "+224612345678", role });
      expect(result.success).toBe(true);
    }
  });

  it("rejette un msisdn mal formé (pas +224 E.164)", () => {
    const result = inviteOrganizationPendingSchema.safeParse({ msisdn: "0612345678", role: "cashier" });

    expect(result.success).toBe(false);
  });

  it("rejette une demande sans role", () => {
    const result = inviteOrganizationPendingSchema.safeParse({ msisdn: "+224612345678" });

    expect(result.success).toBe(false);
  });
});
