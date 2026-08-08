import { describe, expect, it } from "vitest";
import { createOrganizationSchema } from "./create-organization.dto";

describe("createOrganizationSchema", () => {
  it("rejette une organisation sans régime fiscal — jamais de défaut TVA silencieux", () => {
    const result = createOrganizationSchema.safeParse({
      name: "Boutique Aissatou",
      legalForm: "commercial",
      nif: "GN12345678",
    });

    expect(result.success).toBe(false);
  });

  it("accepte une organisation avec régime fiscal explicite", () => {
    const result = createOrganizationSchema.safeParse({
      name: "Boutique Aissatou",
      regimeFiscal: "tpu",
      legalForm: "commercial",
      nif: "GN12345678",
    });

    expect(result.success).toBe(true);
  });

  it("rejette un régime fiscal hors des 4 valeurs autorisées", () => {
    const result = createOrganizationSchema.safeParse({
      name: "Boutique Aissatou",
      regimeFiscal: "exoneree_invente",
      legalForm: "commercial",
      nif: "GN12345678",
    });

    expect(result.success).toBe(false);
  });
});
