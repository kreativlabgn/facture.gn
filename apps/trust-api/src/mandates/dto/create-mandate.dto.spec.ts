import { describe, expect, it } from "vitest";
import { createMandateSchema } from "./create-mandate.dto";

describe("createMandateSchema", () => {
  it("accepte une demande de mandat avec organizationId et grantedRole valides", () => {
    const result = createMandateSchema.safeParse({
      organizationId: "3b3963da-d099-43ea-996b-80000060b28a",
      grantedRole: "accountant_external",
    });

    expect(result.success).toBe(true);
  });

  it("rejette un organizationId mal formé (pas un UUID)", () => {
    const result = createMandateSchema.safeParse({
      organizationId: "pas-un-uuid",
      grantedRole: "accountant_external",
    });

    expect(result.success).toBe(false);
  });

  it("rejette grantedRole business_manager — hors scope MVP (ADR-070, V1)", () => {
    const result = createMandateSchema.safeParse({
      organizationId: "3b3963da-d099-43ea-996b-80000060b28a",
      grantedRole: "business_manager",
    });

    expect(result.success).toBe(false);
  });

  it("rejette une demande sans grantedRole", () => {
    const result = createMandateSchema.safeParse({
      organizationId: "3b3963da-d099-43ea-996b-80000060b28a",
    });

    expect(result.success).toBe(false);
  });
});
