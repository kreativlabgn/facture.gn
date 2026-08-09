import { describe, expect, it } from "vitest";
import { createBranchSchema } from "./create-branch.dto";

describe("createBranchSchema", () => {
  it("accepte une succursale valide", () => {
    const result = createBranchSchema.safeParse({
      organizationId: "11111111-1111-4111-8111-111111111111",
      name: "Boutique Kaloum",
      type: "boutique",
    });
    expect(result.success).toBe(true);
  });

  it("rejette un type hors de l'énumération", () => {
    const result = createBranchSchema.safeParse({
      organizationId: "11111111-1111-4111-8111-111111111111",
      name: "Boutique Kaloum",
      type: "usine",
    });
    expect(result.success).toBe(false);
  });

  it("rejette un nom vide", () => {
    const result = createBranchSchema.safeParse({
      organizationId: "11111111-1111-4111-8111-111111111111",
      name: "",
      type: "boutique",
    });
    expect(result.success).toBe(false);
  });
});
