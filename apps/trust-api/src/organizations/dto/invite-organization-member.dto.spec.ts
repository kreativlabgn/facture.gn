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

  it("rejette role owner — jamais assignable par invitation, seulement à la création (H1)", () => {
    const result = inviteOrganizationMemberSchema.safeParse({ msisdn: "+224612345678", role: "owner" });

    expect(result.success).toBe(false);
  });

  // ADR-096 — client_portal est une identité transverse auto-résolue par téléphone
  // vérifié, jamais un accès délégué classique : elle ne peut structurellement pas
  // être "accordée" par un owner/admin via ce mécanisme d'invitation, qui crée un
  // OrganizationMember révocable — contradiction directe avec "jamais révocable par
  // l'organisation". Élargi par erreur en H1 en même temps qu'ADR-096 était acté,
  // les deux n'ayant jamais été réconciliés.
  it("rejette role client_portal — identité auto-résolue (ADR-096), jamais un accès délégué invitable", () => {
    const result = inviteOrganizationMemberSchema.safeParse({ msisdn: "+224612345678", role: "client_portal" });

    expect(result.success).toBe(false);
  });

  it("accepte les rôles avancés du catalogue (H1, gate désormais porté par plan-features-grid)", () => {
    for (const role of ["inventory_manager", "approver", "auditor", "developer_api", "admin", "cashier"]) {
      const result = inviteOrganizationMemberSchema.safeParse({ msisdn: "+224612345678", role });
      expect(result.success).toBe(true);
    }
  });

  // F3, DAT §3.5 — "proche/assistant", contrairement à client_portal (ADR-096)
  // ceci EST un accès délégué classique, révocable par l'organisation : rien ne
  // s'oppose à ce qu'il transite par le mécanisme d'invitation générique.
  it("accepte role viewer (F3, invitable aussi depuis la PWA)", () => {
    const result = inviteOrganizationMemberSchema.safeParse({ msisdn: "+224612345678", role: "viewer" });

    expect(result.success).toBe(true);
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
