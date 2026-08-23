import { describe, expect, it } from "vitest";
import { createAssistedOrganizationSchema } from "./create-assisted-organization.dto";

function validPayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    organizationName: "Boutique Aissatou",
    regimeFiscal: "tpu",
    legalForm: "commercial",
    merchantName: "Aissatou Diallo",
    consentRecorded: true,
    ...overrides,
  };
}

describe("createAssistedOrganizationSchema — exonération association réservée aux associations (I4, ADR-057)", () => {
  it("rejette regimeFiscal=non_assujetti_association pour une organisation legalForm=commercial", () => {
    const result = createAssistedOrganizationSchema.safeParse(
      validPayload({ regimeFiscal: "non_assujetti_association", legalForm: "commercial" }),
    );

    expect(result.success).toBe(false);
  });

  it("accepte regimeFiscal=non_assujetti_association pour une organisation legalForm=association", () => {
    const result = createAssistedOrganizationSchema.safeParse(
      validPayload({ regimeFiscal: "non_assujetti_association", legalForm: "association" }),
    );

    expect(result.success).toBe(true);
  });

  it("accepte une association avec un régime non exonéré (activité commerciale accessoire imposable)", () => {
    const result = createAssistedOrganizationSchema.safeParse(
      validPayload({ regimeFiscal: "normal_tva", legalForm: "association" }),
    );

    expect(result.success).toBe(true);
  });
});
